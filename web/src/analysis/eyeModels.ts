// Eye-state models, run with TinyNet on crops of the face image: OCEC-S says whether an eye is open, SGC-S whether
// a face wears sunglasses. Both are by Katsuya Hyodo (PINTO0309), MIT licensed; see public/models/LICENSE.txt.
// The crop geometry is the one the scores were calibrated with offline (see faceScoring.ts).

import { assetUrl } from './faces';
import { EYE_MODEL_WIDTH_RANGE, eyeModelTrust } from './faceScoring';
import type { Pixels } from './pixels';
import { TinyNet } from './tinyNet';

export interface Point {
  x: number;
  y: number;
}

/** Corner landmarks of each eye, [outer, inner]; left and right are the subject's. */
export const EYE_CORNERS = { right: [33, 133], left: [263, 362] } as const;
export type EyeSide = keyof typeof EYE_CORNERS;

/** OCEC input: 40×24 RGB, centered between the eye corners, spanning 1.2× and 0.6× the corner distance, rotated level. */
const EYE_CROP = { width: 40, height: 24, widthScale: 1.2, heightScale: 0.6 } as const;
/** Eyes narrower than this many pixels aren't cropped. */
const MIN_EYE_WIDTH = 2;
/**
 * SGC input: 48×48 RGB of the landmark bounding box widened to 1.35× and extended up by 0.5× and down by 0.1× its
 * height, clipped to the image and squashed square: the best of the four crops tried on the CMU face images.
 */
const HEAD_CROP = { size: 48, widthScale: 1.35, top: 0.5, bottom: 0.1 } as const;

export interface EyeReading {
  /** OCEC-S probability that the eye is open. */
  open: number;
  /** Edge detail of the crop the model saw (cropDetail): blur makes the model take open eyes for closed ones. */
  detail: number;
  /** Distance between the eye corners in image pixels. */
  width: number;
}

export interface EyeModels {
  /**
   * OCEC-S reading of one eye, or null if landmarks are missing or the reading would carry no weight (eyeModelTrust
   * 0: the eye is too small or its crop too blurred), so the model doesn't run for nothing.
   */
  readEye(image: Pixels, points: readonly Point[], side: EyeSide): EyeReading | null;
  /** SGC-S probability that the face wears sunglasses, or null if the head crop is empty. */
  sunglassesProbability(image: Pixels, points: readonly Point[]): number | null;
}

/** Downloads both models (served from the app's public folder and cached by the service worker for offline use). */
export async function loadEyeModels(): Promise<EyeModels> {
  const [eye, head] = await Promise.all([fetchNet('models/ocec_s.onnx'), fetchNet('models/sgc_s.onnx')]);
  return createEyeModels(eye, head);
}

async function fetchNet(path: string): Promise<TinyNet> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return TinyNet.fromOnnx(new Uint8Array(await response.arrayBuffer()));
}

export function createEyeModels(eyeNet: TinyNet, headNet: TinyNet): EyeModels {
  expectInput(eyeNet, [3, EYE_CROP.height, EYE_CROP.width]);
  expectInput(headNet, [3, HEAD_CROP.size, HEAD_CROP.size]);
  return {
    readEye(image, points, side) {
      const [outer, inner] = EYE_CORNERS[side];
      if (points.length <= Math.max(outer, inner)) return null;
      const width = Math.hypot(points[outer].x - points[inner].x, points[outer].y - points[inner].y);
      if (!(width > EYE_MODEL_WIDTH_RANGE[0])) return null;
      const crop = eyeCrop(image, points[outer], points[inner]);
      if (!crop) return null;
      const detail = cropDetail(crop, EYE_CROP.width, EYE_CROP.height);
      if (!(eyeModelTrust({ detail, width }) > 0)) return null;
      return { open: eyeNet.run(crop)[0], detail, width };
    },
    sunglassesProbability(image, points) {
      const crop = headCrop(image, points);
      return crop && headNet.run(crop)[0];
    },
  };
}

function expectInput(net: TinyNet, shape: number[]): void {
  if (net.inputShape.join() !== shape.join()) throw new Error(`Unexpected model input ${net.inputShape.join('×')}`);
}

/**
 * Edge detail of a CHW RGB tensor (width×height, values 0...1): the mean Sobel gradient magnitude of its luma over the
 * interior pixels, relative to the luma's standard deviation, so it measures how steep the edges are rather than how
 * contrasty (calibration in faceScoring.ts).
 */
export function cropDetail(tensor: Float32Array, width: number, height: number): number {
  const plane = width * height;
  const luma = new Float32Array(plane);
  let sum = 0;
  for (let i = 0; i < plane; i++) {
    luma[i] = 0.299 * tensor[i] + 0.587 * tensor[plane + i] + 0.114 * tensor[2 * plane + i];
    sum += luma[i];
  }
  const mean = sum / plane;
  let variance = 0;
  for (let i = 0; i < plane; i++) variance += (luma[i] - mean) ** 2;
  const deviation = Math.sqrt(variance / plane);

  let gradient = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const up = i - width;
      const down = i + width;
      const gx = luma[up + 1] + 2 * luma[i + 1] + luma[down + 1] - (luma[up - 1] + 2 * luma[i - 1] + luma[down - 1]);
      const gy = luma[down - 1] + 2 * luma[down] + luma[down + 1] - (luma[up - 1] + 2 * luma[up] + luma[up + 1]);
      gradient += Math.hypot(gx, gy);
    }
  }
  const interior = Math.max(1, (width - 2) * (height - 2));
  return gradient / interior / (deviation + 1e-3);
}

/** OCEC input tensor (CHW, RGB in [0, 1]) for the eye with these corners, or null if it's too small. */
export function eyeCrop(image: Pixels, outer: Point, inner: Point): Float32Array | null {
  const [from, to] = outer.x <= inner.x ? [outer, inner] : [inner, outer]; // level the eye axis left to right
  const width = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(width >= MIN_EYE_WIDTH)) return null;
  const cos = (to.x - from.x) / width;
  const sin = (to.y - from.y) / width;
  const stepU = (EYE_CROP.widthScale * width) / EYE_CROP.width;
  const stepV = (EYE_CROP.heightScale * width) / EYE_CROP.height;
  const center = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  return sampleGrid(image, center, { x: cos * stepU, y: sin * stepU }, { x: -sin * stepV, y: cos * stepV }, EYE_CROP.width, EYE_CROP.height);
}

/** SGC input tensor (CHW, RGB in [0, 1]) of the head around these landmarks, or null if the crop is empty. */
export function headCrop(image: Pixels, points: readonly Point[]): Float32Array | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const x0 = Math.max(0, Math.floor(centerX - (HEAD_CROP.widthScale * width) / 2));
  const x1 = Math.min(image.width, Math.ceil(centerX + (HEAD_CROP.widthScale * width) / 2));
  const y0 = Math.max(0, Math.floor(minY - HEAD_CROP.top * height));
  const y1 = Math.min(image.height, Math.ceil(maxY + HEAD_CROP.bottom * height));
  if (!(x1 > x0 && y1 > y0)) return null;
  const { size } = HEAD_CROP;
  return sampleGrid(image, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, { x: (x1 - x0) / size, y: 0 }, { x: 0, y: (y1 - y0) / size }, size, size);
}

/**
 * Resamples a width×height grid centered on `center` (image coordinates, pixel centers at +0.5), whose pixels step by
 * `stepU` across and `stepV` down, into a CHW float tensor of RGB / 255. Each output pixel averages a grid of bilinear
 * samples at least one source pixel apart over its footprint, so shrinking area-averages rather than aliasing; the
 * image border is replicated.
 */
function sampleGrid(image: Pixels, center: Point, stepU: Point, stepV: Point, width: number, height: number): Float32Array {
  const { data, width: imageWidth, height: imageHeight } = image;
  const plane = width * height;
  const output = new Float32Array(3 * plane);
  const samplesU = Math.max(1, Math.ceil(Math.hypot(stepU.x, stepU.y)));
  const samplesV = Math.max(1, Math.ceil(Math.hypot(stepV.x, stepV.y)));
  const scale = 1 / (255 * samplesU * samplesV);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < samplesV; j++) {
        const dv = v + (j + 0.5) / samplesV - height / 2;
        for (let i = 0; i < samplesU; i++) {
          const du = u + (i + 0.5) / samplesU - width / 2;
          // Continuous coordinates to pixel indices, then bilinear weights with clamped (replicated) edges.
          const px = Math.min(imageWidth - 1, Math.max(0, center.x + du * stepU.x + dv * stepV.x - 0.5));
          const py = Math.min(imageHeight - 1, Math.max(0, center.y + du * stepU.y + dv * stepV.y - 0.5));
          const x0 = Math.floor(px);
          const y0 = Math.floor(py);
          const fx = px - x0;
          const fy = py - y0;
          const right = x0 + 1 < imageWidth ? 4 : 0;
          const down = y0 + 1 < imageHeight ? imageWidth * 4 : 0;
          const o = (y0 * imageWidth + x0) * 4;
          const w00 = (1 - fx) * (1 - fy);
          const w01 = fx * (1 - fy);
          const w10 = (1 - fx) * fy;
          const w11 = fx * fy;
          r += w00 * data[o] + w01 * data[o + right] + w10 * data[o + down] + w11 * data[o + down + right];
          g += w00 * data[o + 1] + w01 * data[o + right + 1] + w10 * data[o + down + 1] + w11 * data[o + down + right + 1];
          b += w00 * data[o + 2] + w01 * data[o + right + 2] + w10 * data[o + down + 2] + w11 * data[o + down + right + 2];
        }
      }
      const index = v * width + u;
      output[index] = r * scale;
      output[plane + index] = g * scale;
      output[2 * plane + index] = b * scale;
    }
  }
  return output;
}
