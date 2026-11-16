// Pure RGBA pixel operations on plain arrays (no DOM, unit tested).
//
// Metrics are computed on images downscaled here rather than by canvas drawImage: browsers smooth differently
// (measured: the Laplacian variance of the same face crop differed 3× between WebKit and Chromium with
// imageSmoothingQuality 'high'), while an exact area average gives identical numbers everywhere.

/** Integer pixel rectangle. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** RGBA pixels, row-major, 4 bytes per pixel (ImageData-compatible). */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Smallest integer rectangle inside a width×height image that covers the (fractional) box; may be empty. */
export function pixelRect(box: { x: number; y: number; width: number; height: number }, width: number, height: number): PixelRect {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.width));
  const y1 = Math.min(height, Math.ceil(box.y + box.height));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** Per output pixel along one axis: the first source pixel and the weights of the source pixels it covers. */
interface AxisWeights {
  first: Int32Array;
  count: Int32Array;
  weights: Float32Array;
  stride: number;
}

function axisWeights(start: number, length: number, size: number): AxisWeights {
  const scale = length / size;
  const stride = Math.ceil(scale) + 1;
  const first = new Int32Array(size);
  const count = new Int32Array(size);
  const weights = new Float32Array(size * stride);
  for (let i = 0; i < size; i++) {
    const a = i * scale;
    const b = Math.min(length, (i + 1) * scale);
    const p0 = Math.floor(a);
    const p1 = Math.min(length, Math.ceil(b));
    first[i] = start + p0;
    count[i] = p1 - p0;
    for (let p = p0; p < p1; p++) weights[i * stride + p - p0] = (Math.min(p + 1, b) - Math.max(p, a)) / scale;
  }
  return { first, count, weights, stride };
}

/**
 * Area-averaging (box filter) resample of `rect` of the source to width×height. Downscaling only: the output
 * must not be larger than the rectangle in either dimension.
 */
export function downscaleArea(source: Pixels, rect: PixelRect, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  if (width > rect.width || height > rect.height || width < 1 || height < 1) {
    throw new RangeError(`Cannot downscale ${rect.width}×${rect.height} to ${width}×${height}`);
  }
  const xs = axisWeights(rect.x, rect.width, width);
  const ys = axisWeights(rect.y, rect.height, height);
  const output = new Uint8ClampedArray(width * height * 4);
  const row = new Float32Array(width * 4);
  const sum = new Float32Array(width * 4);
  for (let j = 0; j < height; j++) {
    sum.fill(0);
    for (let k = 0; k < ys.count[j]; k++) {
      const weight = ys.weights[j * ys.stride + k];
      resampleRow(source, ys.first[j] + k, xs, row);
      for (let i = 0; i < row.length; i++) sum[i] += weight * row[i];
    }
    output.set(sum, j * width * 4); // rounds and clamps to 0...255
  }
  return output;
}

function resampleRow({ data, width: sourceWidth }: Pixels, y: number, xs: AxisWeights, row: Float32Array): void {
  const rowStart = y * sourceWidth * 4;
  for (let i = 0; i < xs.first.length; i++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let offset = rowStart + xs.first[i] * 4;
    for (let k = 0; k < xs.count[i]; k++, offset += 4) {
      const weight = xs.weights[i * xs.stride + k];
      r += weight * data[offset];
      g += weight * data[offset + 1];
      b += weight * data[offset + 2];
      a += weight * data[offset + 3];
    }
    row[i * 4] = r;
    row[i * 4 + 1] = g;
    row[i * 4 + 2] = b;
    row[i * 4 + 3] = a;
  }
}

/** Copies `rect` of the source into the top-left of `target` (which must be rect-sized). */
export function copyRect(source: Pixels, rect: PixelRect, target: Pixels): void {
  if (target.width !== rect.width || target.height !== rect.height) throw new RangeError('Target size mismatch');
  for (let y = 0; y < rect.height; y++) {
    const start = ((rect.y + y) * source.width + rect.x) * 4;
    target.data.set(source.data.subarray(start, start + rect.width * 4), y * rect.width * 4);
  }
}

/** Fills the part of `rect` (fractional coordinates allowed) that lies inside the image with an opaque gray. */
export function fillRect(target: Pixels, rect: { x: number; y: number; width: number; height: number }, gray: number): void {
  const clipped = pixelRect(rect, target.width, target.height);
  for (let y = clipped.y; y < clipped.y + clipped.height; y++) {
    const start = (y * target.width + clipped.x) * 4;
    for (let offset = start; offset < start + clipped.width * 4; offset += 4) {
      target.data[offset] = gray;
      target.data[offset + 1] = gray;
      target.data[offset + 2] = gray;
      target.data[offset + 3] = 255;
    }
  }
}
