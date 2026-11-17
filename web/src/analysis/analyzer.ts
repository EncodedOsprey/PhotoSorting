// The on-device photo analysis engine: decodes each picked photo, measures sharpness/exposure/similarity on a
// small copy, finds faces with MediaPipe Face Landmarker and scores them, reading eyes with small eye models.
// Photos never leave the device.
//
// Per photo:  decode (EXIF-oriented) → "face image" (long edge ≤ 2048, canvas) → its RGBA pixels, from which
//             the 512px metrics image and face crops are area-averaged in JS (identical in every browser)
//             → sharpness, exposure, descriptor · faces (whole image + tiles) → focus, eyes, sunglasses per face
//             · 400px thumbnail · EXIF capture time
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { computeDescriptor, exposureScore, laplacianVariance, sharpnessScore, toGrayscale } from '../core';
import type { FaceMetrics } from '../core/types';
import { canvasToJpegUrl, context2d, createCanvas, fitWithin, freeCanvas, readPixels, resizeCanvas, Resampler, type Size } from './canvas';
import { decodeImage, ImageDecodeError, type DecodedImage } from './decode';
import { readCaptureTime } from './exif';
import { loadEyeModels, type EyeModels, type EyeReading } from './eyeModels';
import {
  captureQuality,
  clamp01,
  eyeShapes,
  eyesOpenScore,
  faceSizeScore,
  focusRegions,
  focusScale,
  focusScore,
  frontalness,
  headPose,
  interOcularDistance,
  smileScore,
  SUNGLASSES_THRESHOLD,
  type EyeShape,
  type HeadPose,
} from './faceScoring';
import { detectFaces, ENGINE_LOAD_ERROR, loadFaceLandmarker, type DetectedFace, type DetectFacesStats, type TileBuffers } from './faces';
import { fileKey } from './files';
import { isLikelyScreenshot, photoSharpness } from './metrics';
import { downscaleArea, pixelRect, type Pixels } from './pixels';
import { AnalysisCancelled, createCheckpoint, yieldToEventLoop } from './scheduling';
import { boxArea, DEFAULT_TILING, keepSubjectFaces, planTiles, type Box, type TilingOptions } from './tiling';
import type {
  AnalysisOutcome,
  AnalyzedFace,
  AnalyzedPhoto,
  AnalyzeOptions,
  NormalizedBox,
  PhotoAnalyzer,
} from './types';

/** Long edge of the image faces are detected in (and face crops are measured on). */
export const FACE_IMAGE_MAX_EDGE = 2048;
/** Long edge of the image whole-photo metrics are computed on (core sharpnessScore is calibrated for ~512px). */
export const METRICS_MAX_EDGE = 512;
export const THUMBNAIL_MAX_EDGE = 400;
const THUMBNAIL_QUALITY = 0.82;
/** Long scans yield to the event loop at least this often (ms) so the UI can repaint and Cancel works. */
const TIME_SLICE_MS = 50;

export const DECODE_FAILURE_REASON = "This image format can't be opened in this browser";
export const ANALYSIS_FAILURE_REASON = "Couldn't analyze this photo";

export interface PhotoAnalyzerOptions {
  /** Receives per-photo measurements and timings (used by the dev harness and for calibration). */
  onDiagnostics?: (diagnostics: PhotoDiagnostics) => void;
  /** Face-detection tiling (defaults to DEFAULT_TILING). */
  tiling?: TilingOptions;
}

export interface PhotoTimings {
  /** Waiting for the decoded image (often ~0: the next photo is decoded while the current one is analyzed). */
  decode: number;
  /** Drawing the working images (includes the browser's lazy decode work in some engines). */
  resize: number;
  /** Whole-image sharpness, exposure and descriptor. */
  metrics: number;
  /** All face-detection passes. */
  faces: number;
  /** Per-face focus, eye models and scores. */
  faceMetrics: number;
  /** Thumbnail JPEG and EXIF. */
  finish: number;
  total: number;
}

export interface FaceDiagnostics {
  box: NormalizedBox;
  /** Detection pass that produced the face (0 = whole image). */
  pass: number;
  /** Face (landmark box) width in original-image pixels. */
  widthPx: number;
  smile: number;
  eyesOpen: number;
  /** False when the face wears sunglasses (sunglasses ≥ SUNGLASSES_THRESHOLD). */
  eyesVisible: boolean;
  captureQuality: number;
  blendshapes: Record<string, number>;
  /** Eye shapes (aspect ratio and width) [subject's left, right] from landmarks. */
  eyeShape: [EyeShape, EyeShape];
  /** Eye model readings [subject's left, right]; null where the model isn't trusted (too small or blurred), so not run. */
  eyeModel: [EyeReading | null, EyeReading | null];
  /** Probability that the face wears sunglasses (SGC-S); null when the head crop is empty. */
  sunglasses: number | null;
  pose: HeadPose | null;
  /** Laplacian variance of the eye regions (see measureFocus), null when the face is too small to judge focus. */
  sharpnessVariance: number | null;
  /** focusScore of sharpnessVariance. */
  sharpness: number | null;
  frontalness: number;
  size: number;
}

export interface PhotoDiagnostics {
  key: string;
  name: string;
  width: number;
  height: number;
  faceImage: Size;
  wholeSharpness: number;
  /**
   * Soft minimum of the main subjects' focus scores (see photoSharpness), which is the photo's sharpness; null when
   * no main face can be judged (the photo's sharpness is then wholeSharpness).
   */
  subjectSharpness: number | null;
  detector: DetectFacesStats & { merged: number; dropped: number };
  faces: FaceDiagnostics[];
  timings: PhotoTimings;
}

/** Blendshapes reported in diagnostics (the full set has 52). */
const DIAGNOSTIC_BLENDSHAPES = [
  'mouthSmileLeft',
  'mouthSmileRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'cheekSquintLeft',
  'cheekSquintRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'jawOpen',
];

/** Canvases and buffers reused for every photo of an analyzer (bounded memory; freed after each analyze() run). */
class Workspace {
  readonly resampler = new Resampler();
  readonly faceImage = createCanvas(true);
  readonly metrics = createCanvas();
  readonly thumbnail = createCanvas();
  readonly tileBuffers: TileBuffers = new Map();

  free(): void {
    [this.faceImage, this.metrics, this.thumbnail].forEach(freeCanvas);
    this.resampler.free();
    this.tileBuffers.clear();
  }
}

/** The models analysis runs, loaded together. */
interface Engine {
  landmarker: FaceLandmarker;
  eyes: EyeModels;
}

/** Loads the face landmarker and the eye models in parallel; nothing stays open if either fails. */
async function loadEngine(): Promise<Engine> {
  const eyes = loadEyeModels();
  eyes.catch(() => undefined); // handled below; avoid unhandled-rejection noise if the landmarker fails first
  const landmarker = await loadFaceLandmarker();
  try {
    return { landmarker, eyes: await eyes };
  } catch (error) {
    landmarker.close();
    throw error;
  }
}

export function createPhotoAnalyzer(options: PhotoAnalyzerOptions = {}): PhotoAnalyzer {
  const tiling = options.tiling ?? DEFAULT_TILING;
  let engine: Promise<Engine> | null = null;
  let workspace: Workspace | null = null;
  /** Bumped by close(): runs started before it stop at the next checkpoint. */
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const load = (): Promise<Engine> => {
    if (!engine) {
      const loading = loadEngine().catch((error: unknown) => {
        if (engine === loading) engine = null; // let Retry load again
        console.error('Analysis engine failed to load', error);
        throw new Error(ENGINE_LOAD_ERROR, { cause: error });
      });
      engine = loading;
    }
    return engine;
  };

  const run = async (
    files: ReadonlyArray<{ file: File; order: number }>,
    { onProgress, signal }: AnalyzeOptions,
  ): Promise<AnalysisOutcome> => {
    const outcome: AnalysisOutcome = { photos: [], failures: [], cancelled: false };
    if (signal?.aborted) return { ...outcome, cancelled: true };
    const runGeneration = generation;
    const models = await load();
    const stopped = () => signal?.aborted === true || generation !== runGeneration;
    const space = (workspace ??= new Workspace());
    const checkpoint = createCheckpoint(signal, TIME_SLICE_MS);
    // Decoding of the next photo, started while the current one is analyzed (a holder: closures assign it).
    const prefetched: { next: Promise<DecodedImage> | null } = { next: null };
    const startDecode = (index: number): Promise<DecodedImage> => {
      const decoding = decodeImage(files[index].file);
      decoding.catch(() => undefined); // handled when awaited; avoid unhandled-rejection noise if abandoned
      return decoding;
    };

    try {
      for (let index = 0; index < files.length; index++) {
        if (stopped()) {
          outcome.cancelled = true;
          break;
        }
        const { file, order } = files[index];
        const decoding = prefetched.next ?? startDecode(index);
        prefetched.next = null;
        // Decode the next photo while this one is analyzed, but only after this one's full-size pixels are gone.
        const prefetch = () => {
          if (!prefetched.next && index + 1 < files.length && !stopped()) prefetched.next = startDecode(index + 1);
        };
        let current: { name: string; thumbnailUrl?: string } = { name: file.name };
        try {
          const { photo, diagnostics } = await analyzePhoto(
            { engine: models, space, tiling, checkpoint },
            file,
            order,
            decoding,
            prefetch,
          );
          if (stopped()) {
            URL.revokeObjectURL(photo.thumbnailUrl);
            outcome.cancelled = true;
            break;
          }
          outcome.photos.push(photo);
          current = { name: photo.name, thumbnailUrl: photo.thumbnailUrl };
          options.onDiagnostics?.(diagnostics);
        } catch (error) {
          prefetch();
          if (error instanceof AnalysisCancelled || stopped()) {
            outcome.cancelled = true;
            break;
          }
          if (!(error instanceof ImageDecodeError)) console.warn(`Analysis of ${file.name} failed`, error);
          outcome.failures.push({
            key: fileKey(file),
            name: file.name,
            reason: error instanceof ImageDecodeError ? DECODE_FAILURE_REASON : ANALYSIS_FAILURE_REASON,
          });
        }
        try {
          onProgress?.({
            completed: index + 1,
            total: files.length,
            failed: outcome.failures.length,
            current,
          });
        } catch (error) {
          console.error('onProgress callback threw', error);
        }
        await yieldToEventLoop();
      }
    } finally {
      prefetched.next?.then((decoded) => decoded.release(), () => undefined);
      if (workspace === space) space.free();
    }
    return outcome;
  };

  return {
    init: async () => {
      await load();
    },
    analyze: (files, analyzeOptions = {}) => {
      // One analysis at a time: runs share the models and the canvases.
      const result = queue.then(() => run(files, analyzeOptions));
      queue = result.catch(() => undefined);
      return result;
    },
    close: () => {
      generation += 1;
      const loaded = engine;
      engine = null;
      loaded?.then(({ landmarker }) => landmarker.close(), () => undefined);
      workspace?.free();
      workspace = null;
    },
  };
}

interface PhotoContext {
  engine: Engine;
  space: Workspace;
  tiling: TilingOptions;
  checkpoint: () => Promise<void>;
}

async function analyzePhoto(
  { engine, space, tiling, checkpoint }: PhotoContext,
  file: File,
  order: number,
  decoding: Promise<DecodedImage>,
  onDecoded: () => void,
): Promise<{ photo: AnalyzedPhoto; diagnostics: PhotoDiagnostics }> {
  const start = performance.now();
  let mark = start;
  const lap = (): number => {
    const now = performance.now();
    const elapsed = now - mark;
    mark = now;
    return elapsed;
  };
  const capturedAtPromise = readCaptureTime(file);

  // 1. Decode and draw the face image; drop the full-size pixels right away.
  const decoded = await decoding;
  const decodeMs = lap();
  const { width, height } = decoded;
  const faceSize = fitWithin(width, height, FACE_IMAGE_MAX_EDGE);
  try {
    space.resampler.draw(decoded.image, { x: 0, y: 0, width, height }, space.faceImage, faceSize.width, faceSize.height);
  } finally {
    decoded.release();
    onDecoded();
  }
  const faceImage = readPixels(space.faceImage);
  const resizeMs = lap();

  // 2. Whole-image metrics on the 512px image.
  const metricsSize = fitWithin(faceSize.width, faceSize.height, METRICS_MAX_EDGE);
  const rgba = downscaleArea(faceImage, wholeRect(faceSize), metricsSize.width, metricsSize.height);
  const gray = toGrayscale(rgba, metricsSize.width, metricsSize.height);
  const wholeSharpness = sharpnessScore(laplacianVariance(gray, metricsSize.width, metricsSize.height));
  const exposure = exposureScore(gray);
  const descriptor = computeDescriptor(rgba, metricsSize.width, metricsSize.height);
  const metricsMs = lap();
  await checkpoint();

  // 3. Faces: whole image + tiles, merged; tiny and background faces dropped; largest first.
  const stats: DetectFacesStats = { calls: 0, raw: 0, partial: 0, passMs: [] };
  const plan = planTiles(faceSize.width, faceSize.height, tiling);
  const detected = await detectFaces(engine.landmarker, faceImage, plan, space.tileBuffers, checkpoint, stats);
  const subjects = keepSubjectFaces(detected, faceSize.width, faceSize.height).sort(
    (a, b) => boxArea(b.box) - boxArea(a.box),
  );
  const facesMs = lap();

  // 4. Per-face focus, eyes and scores; the photo is as sharp as its main subjects (or the whole image without
  //    judgeable faces).
  const toOriginal = width / faceSize.width;
  const focus = subjects.map((face) => measureFocus(faceImage, face.points));
  const { sharpness, subjectSharpness } = photoSharpness(
    subjects.map((face, index) => ({ focus: focus[index]?.score ?? null, width: face.box.width })),
    wholeSharpness,
  );
  // The eye models take several ms per face: yield between faces so big groups don't freeze the UI or Cancel.
  const measured: { face: AnalyzedFace; diagnostics: FaceDiagnostics }[] = [];
  for (const [index, face] of subjects.entries()) {
    await checkpoint();
    measured.push(measureFace(faceImage, face, engine.eyes, toOriginal, focus[index], sharpness));
  }
  const faceMetricsMs = lap();

  // 5. Thumbnail (from the 512px image) and capture time.
  context2d(resizeCanvas(space.metrics, metricsSize.width, metricsSize.height)).putImageData(
    new ImageData(rgba, metricsSize.width, metricsSize.height),
    0,
    0,
  );
  const thumbSize = fitWithin(metricsSize.width, metricsSize.height, THUMBNAIL_MAX_EDGE);
  space.resampler.draw(space.metrics, wholeRect(metricsSize), space.thumbnail, thumbSize.width, thumbSize.height);
  const thumbnailUrl = await canvasToJpegUrl(space.thumbnail, THUMBNAIL_QUALITY);
  const capturedAt = await capturedAtPromise;
  const finishMs = lap();

  const faces: AnalyzedFace[] = measured.map(({ face }) => face);
  const photo: AnalyzedPhoto = {
    key: fileKey(file),
    file,
    name: file.name,
    order,
    capturedAt,
    width,
    height,
    thumbnailUrl,
    metrics: {
      faces: faces.map(({ smile, eyesOpen, eyesVisible, captureQuality, areaFraction }): FaceMetrics => ({
        smile,
        eyesOpen,
        eyesVisible,
        captureQuality,
        areaFraction,
      })),
      sharpness,
      exposure,
      aesthetics: null,
      isUtility: isLikelyScreenshot(file, width, height, capturedAt !== null),
    },
    faces,
    descriptor,
  };
  const diagnostics: PhotoDiagnostics = {
    key: photo.key,
    name: photo.name,
    width,
    height,
    faceImage: faceSize,
    wholeSharpness,
    subjectSharpness,
    detector: { ...stats, merged: detected.length, dropped: detected.length - subjects.length },
    faces: measured.map(({ diagnostics: faceDiagnostics }) => faceDiagnostics),
    timings: {
      decode: decodeMs,
      resize: resizeMs,
      metrics: metricsMs,
      faces: facesMs,
      faceMetrics: faceMetricsMs,
      finish: finishMs,
      total: performance.now() - start,
    },
  };
  return { photo, diagnostics };
}

function measureFace(
  faceImage: Pixels,
  face: DetectedFace,
  eyes: EyeModels,
  toOriginal: number,
  focus: FocusMeasurement | null,
  fallbackSharpness: number,
): { face: AnalyzedFace; diagnostics: FaceDiagnostics } {
  const box = normalizedBox(face.box, faceImage);
  const smile = smileScore(face.blendshapes);
  const eyeShape = eyeShapes(face.points);
  const eyeModel: [EyeReading | null, EyeReading | null] = [
    eyes.readEye(faceImage, face.points, 'left'),
    eyes.readEye(faceImage, face.points, 'right'),
  ];
  const eyesOpen = eyesOpenScore(face.blendshapes, eyeShape, eyeModel);
  const sunglasses = eyes.sunglassesProbability(faceImage, face.points);
  const eyesVisible = (sunglasses ?? 0) < SUNGLASSES_THRESHOLD;
  const pose = face.matrix ? headPose(face.matrix) : null;
  const frontal = pose ? frontalness(pose.offAxis) : 0.5;
  const widthPx = face.box.width * toOriginal;
  const size = faceSizeScore(widthPx);
  // A face too small to judge is taken to be as sharp as the photo.
  const quality = captureQuality({ sharpness: focus?.score ?? fallbackSharpness, frontalness: frontal, size });

  const blendshapes: Record<string, number> = {};
  for (const name of DIAGNOSTIC_BLENDSHAPES) blendshapes[name] = face.blendshapes[name] ?? 0;
  return {
    face: { box, smile, eyesOpen, eyesVisible, captureQuality: quality, areaFraction: box.width * box.height },
    diagnostics: {
      box,
      pass: face.pass,
      widthPx,
      smile,
      eyesOpen,
      eyesVisible,
      captureQuality: quality,
      blendshapes,
      eyeShape,
      eyeModel,
      sunglasses,
      pose,
      sharpnessVariance: focus?.variance ?? null,
      sharpness: focus?.score ?? null,
      frontalness: frontal,
      size,
    },
  };
}

interface FocusMeasurement {
  /** Laplacian variance of the eye regions. */
  variance: number;
  score: number;
}

/**
 * Focus of a face, judged on its eyes and brows only (focusRegions: no background, hair or face outline), each eye
 * area-averaged to focusScale so the value reflects focus and motion blur rather than face size. Null when the face
 * is too small to judge.
 */
function measureFocus(faceImage: Pixels, points: DetectedFace['points']): FocusMeasurement | null {
  const interOcular = interOcularDistance(points);
  const scale = focusScale(interOcular);
  if (scale === null) return null;
  let weightedVariance = 0;
  let samples = 0;
  for (const region of focusRegions(points)) {
    const rect = pixelRect(region, faceImage.width, faceImage.height);
    const width = Math.min(rect.width, Math.round(rect.width * scale));
    const height = Math.min(rect.height, Math.round(rect.height * scale));
    if (width < 3 || height < 3) continue;
    const gray = toGrayscale(downscaleArea(faceImage, rect, width, height), width, height);
    const count = (width - 2) * (height - 2);
    weightedVariance += count * laplacianVariance(gray, width, height);
    samples += count;
  }
  if (samples === 0) return null;
  const variance = weightedVariance / samples;
  return { variance, score: focusScore(variance, interOcular) };
}

function normalizedBox(box: Box, size: Size): NormalizedBox {
  const x0 = clamp01(box.x / size.width);
  const y0 = clamp01(box.y / size.height);
  const x1 = clamp01((box.x + box.width) / size.width);
  const y1 = clamp01((box.y + box.height) / size.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function wholeRect(size: Size): Box {
  return { x: 0, y: 0, width: size.width, height: size.height };
}
