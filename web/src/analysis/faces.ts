// Face detection with MediaPipe Face Landmarker, run over the whole image and overlapping tiles.
//
// The landmarker's detector is BlazeFace short-range: it sees its input letterboxed to 128×128 and only reliably
// finds faces at least ~1/9 of the input wide (see RELIABLE_FACE_FRACTION). Group photos are therefore also scanned in
// overlapping square tiles cut 1:1 from the same ≤2048px "face image" (the landmark model gets identical
// pixels in every pass); detections are mapped back to image coordinates and merged. Faces already found are
// painted over in later tiles: an empty tile costs ~5 ms but every face found costs ~20 ms (landmarks +
// blendshapes), so re-finding the same faces in overlapping tiles used to dominate the time for group photos.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Blendshapes } from './faceScoring';
import { copyRect, fillRect } from './pixels';
import {
  boxFromTilePoints,
  finerPassUseful,
  interiorEdgeMargin,
  mergeDetections,
  tileSide,
  MIN_TILE_EDGE_MARGIN,
  type Box,
  type Detection,
  type Tile,
  type TilePlan,
} from './tiling';

export const ENGINE_LOAD_ERROR = "Couldn't load the photo analysis engine. Check your connection and try again.";

/** Up to this many faces per detector call (one tile); whole-image totals are unbounded. */
const MAX_FACES_PER_CALL = 20;
/**
 * Detector score threshold. MediaPipe's default 0.5 let the many small tiles find faces in a spoon, a door knob,
 * a dog and a golden ball (Kodak, dlib and darknet sample photos); 0.6 rejected those and still found all
 * probe faces ≥ 10% of the input (0.7 started missing faces at 10–11%).
 */
const MIN_DETECTION_CONFIDENCE = 0.6;
/** Landmark-model face presence threshold (MediaPipe default; raising it to 0.9 removed no false positives). */
const MIN_PRESENCE_CONFIDENCE = 0.5;
/** Found faces are masked in later tiles with this gray, padded by this fraction of the face size. */
const MASK_GRAY = 128;
const MASK_PADDING = 0.1;

/** Absolute URL of a file in the app's public folder, relative to the document (works under any base path). */
export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

export async function loadFaceLandmarker(): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(assetUrl('mediapipe/wasm'));
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: assetUrl('mediapipe/face_landmarker.task'),
      // WebGL compute in iOS Safari is unreliable; the WASM CPU path (XNNPACK, SIMD) works everywhere.
      delegate: 'CPU',
    },
    runningMode: 'IMAGE',
    numFaces: MAX_FACES_PER_CALL,
    minFaceDetectionConfidence: MIN_DETECTION_CONFIDENCE,
    minFacePresenceConfidence: MIN_PRESENCE_CONFIDENCE,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  disableUsageLogging(landmarker);
  return landmarker;
}

/**
 * MediaPipe Tasks 1.2.3 reports usage statistics (task type, platform, latencies; no image data) to
 * odml.pa.googleapis.com every minute and on close. The app promises that nothing leaves the device and must work
 * offline, so the task's logger is detached. Guarded by shape checks: a different library version is left as is.
 */
function disableUsageLogging(task: FaceLandmarker): void {
  const runner = task as unknown as { o?: { xa?: unknown; za?: unknown; m?: { i?: unknown; h?: unknown } } };
  const logger = runner.o;
  if (!logger || typeof logger.xa !== 'function' || typeof logger.za !== 'function') return;
  const transport = logger.m;
  if (transport && Array.isArray(transport.i)) transport.i.length = 0; // queued "graph started" event
  if (transport && typeof transport.h === 'number') {
    clearInterval(transport.h);
    transport.h = undefined;
  }
  runner.o = undefined; // the task calls its logger as this.o?.…
}

export interface DetectedFace extends Detection {
  /** 478 landmarks in face-image pixels. */
  points: { x: number; y: number }[];
  blendshapes: Blendshapes;
  /** 4×4 facial transformation matrix (column-major), or null if missing. */
  matrix: number[] | null;
  /** Index of the pass (0 = whole image) that produced this detection. */
  pass: number;
}

export interface DetectFacesStats {
  /** Detector invocations (tiles). */
  calls: number;
  /** Whole faces found (before merging duplicates). */
  raw: number;
  /** Detections rejected because they were cut by a tile edge. */
  partial: number;
  /** Milliseconds spent per pass that ran (finer passes are skipped when they can't add a subject face). */
  passMs: number[];
}

/** Reusable tile pixel buffers, one per tile size (each grid pass uses a single size). */
export type TileBuffers = Map<string, ImageData>;

/**
 * Runs the landmarker on every tile of `plan` (pass 0 must be the whole image) and returns the merged faces.
 * `pause` is awaited between tiles so long scans yield to the UI (and can throw to cancel).
 */
export async function detectFaces(
  landmarker: FaceLandmarker,
  image: ImageData,
  plan: TilePlan,
  buffers: TileBuffers,
  pause: () => Promise<void>,
  stats: DetectFacesStats = { calls: 0, raw: 0, partial: 0, passMs: [] },
): Promise<DetectedFace[]> {
  const { width, height } = image;
  const found: DetectedFace[] = [];
  const usedBuffers = new Set<string>();
  for (let pass = 0; pass < plan.length; pass++) {
    const largest = Math.max(0, ...found.map(({ box }) => box.width));
    if (pass > 0 && !finerPassUseful(tileSide(plan[pass - 1][0]), largest)) break;
    const passStart = performance.now();
    for (const tile of plan[pass]) {
      const input = pass === 0 ? image : tileImage(image, tile, found, buffers, usedBuffers);
      const result = landmarker.detect(input);
      stats.calls += 1;
      result.faceLandmarks.forEach((landmarks, i) => {
        const box = boxFromTilePoints(landmarks, tile);
        const margin = interiorEdgeMargin(box, tile, width, height);
        if (margin < MIN_TILE_EDGE_MARGIN || box.width <= 0 || box.height <= 0) {
          stats.partial += 1;
          return;
        }
        found.push({
          box,
          margin,
          points: landmarks.map(({ x, y }) => ({ x: tile.x + x * tile.width, y: tile.y + y * tile.height })),
          blendshapes: toBlendshapes(result.faceBlendshapes[i]?.categories),
          matrix: result.facialTransformationMatrixes[i]?.data ?? null,
          pass,
        });
      });
      await pause();
    }
    stats.passMs.push(performance.now() - passStart);
  }
  for (const key of buffers.keys()) if (!usedBuffers.has(key)) buffers.delete(key);
  stats.raw += found.length;
  return mergeDetections(found);
}

/** The tile's pixels (copied 1:1, no resampling) with the faces found so far painted over. */
function tileImage(image: ImageData, tile: Tile, found: readonly Detection[], buffers: TileBuffers, used: Set<string>): ImageData {
  const key = `${tile.width}x${tile.height}`;
  let buffer = buffers.get(key);
  if (!buffer) {
    buffer = new ImageData(tile.width, tile.height);
    buffers.set(key, buffer);
  }
  used.add(key);
  copyRect(image, tile, buffer);
  for (const { box } of found) fillRect(buffer, maskRect(box, tile), MASK_GRAY);
  return buffer;
}

function maskRect(box: Box, tile: Tile): Box {
  const pad = MASK_PADDING * Math.max(box.width, box.height);
  return { x: box.x - pad - tile.x, y: box.y - pad - tile.y, width: box.width + 2 * pad, height: box.height + 2 * pad };
}

function toBlendshapes(categories: ReadonlyArray<{ categoryName: string; score: number }> | undefined): Blendshapes {
  const result: Record<string, number> = {};
  for (const { categoryName, score } of categories ?? []) result[categoryName] = score;
  return result;
}
