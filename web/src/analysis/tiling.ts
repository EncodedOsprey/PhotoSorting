// Pure geometry for multi-scale face detection: tile planning, mapping detections back to the image,
// rejecting partial/tiny faces and merging duplicates found by several passes. No DOM; unit tested.

/** Axis-aligned rectangle in image pixels (origin top-left). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One detector input: a crop of the face image (or the whole image), in face-image pixels. */
export type Tile = Box;

/** Detection passes, coarse to fine. Each pass is a set of overlapping tiles covering the image. */
export type TilePlan = Tile[][];

export interface TilingOptions {
  /**
   * Tile side of each grid pass as a fraction of the image's long edge, coarse to fine (the whole image is
   * always pass 0). Square tiles use the detector's square input fully; tiles are clamped to the image.
   */
  tileFractions: readonly number[];
}

/**
 * Faces at least this wide relative to the detector input's long side are found reliably. Measured with the
 * harness's probeFaceScale (9 portraits pasted at known sizes on 128–1024px inputs, WebKit and Chromium):
 * 100% found at ≥ 0.11, 30–90% at 0.09, ~0% at ≤ 0.08, independent of the input size.
 */
export const RELIABLE_FACE_FRACTION = 0.12;
/** Landmark boxes are up to ~1.2× taller than wide; tile overlaps must fit the face's larger side. */
const FACE_HEIGHT_RATIO = 1.2;
/** A detection closer than this (× face size) to an interior tile edge is treated as a partial face. */
export const MIN_TILE_EDGE_MARGIN = 0.1;

/**
 * Whole image, then tiles of 0.6 and 0.27 of the long edge. The whole image finds faces ≥ 12% of the long
 * edge, 0.6-tiles (2×2 on 4:3 and 3:2 photos) ≥ 7.2%, 0.27-tiles (6×4) ≥ 3.2% (~2.4% with luck), so group
 * photos with faces ≥ 3% of the width are covered. Each grid's overlap fits the largest face the previous pass
 * may have missed plus margins. Measured cost per detector call is 4–7 ms for an empty tile vs ~20 ms per face
 * found (landmarks + blendshapes), so faces already found are masked out of later tiles (see faces.ts).
 */
export const DEFAULT_TILING: TilingOptions = { tileFractions: [0.6, 0.27] };

/** Tiles of `tileSize` (clamped to the image) covering width×height, neighbours overlapping by ≥ minOverlap px. */
export function gridTiles(width: number, height: number, tileSize: number, minOverlap: number): Tile[] {
  const tileWidth = Math.min(width, Math.round(tileSize));
  const tileHeight = Math.min(height, Math.round(tileSize));
  const xs = axisOffsets(width, tileWidth, minOverlap);
  const ys = axisOffsets(height, tileHeight, minOverlap);
  const tiles: Tile[] = [];
  for (const y of ys) for (const x of xs) tiles.push({ x, y, width: tileWidth, height: tileHeight });
  return tiles;
}

/** Evenly spaced tile offsets along one axis: as few tiles as possible with at least minOverlap px overlap. */
function axisOffsets(length: number, tile: number, minOverlap: number): number[] {
  if (tile >= length) return [0];
  const maxStride = Math.max(1, tile - minOverlap);
  const count = Math.max(2, Math.ceil((length - tile) / maxStride) + 1);
  const stride = (length - tile) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(i * stride));
}

/** Overlap needed so every face the previous (coarser) pass may have missed lies wholly inside some tile. */
export function requiredOverlap(previousTileSide: number): number {
  return Math.ceil((1 + 2 * MIN_TILE_EDGE_MARGIN) * FACE_HEIGHT_RATIO * RELIABLE_FACE_FRACTION * previousTileSide);
}

/** Side length the detector sees for a tile (it letterboxes the longer side). */
export function tileSide(tile: Tile): number {
  return Math.max(tile.width, tile.height);
}

/** The whole image followed by one grid pass per tile fraction; passes that would repeat the previous one are skipped. */
export function planTiles(width: number, height: number, options: TilingOptions = DEFAULT_TILING): TilePlan {
  const plan: TilePlan = [[{ x: 0, y: 0, width, height }]];
  for (const fraction of options.tileFractions) {
    const previous = plan[plan.length - 1];
    const overlap = requiredOverlap(tileSide(previous[0]));
    const tiles = gridTiles(width, height, fraction * Math.max(width, height), overlap);
    if (tiles.length > previous.length && tileSide(tiles[0]) < tileSide(previous[0])) plan.push(tiles);
  }
  return plan;
}

/**
 * Whether a finer pass after one with tiles of `previousTileSide` can still find a subject face. It can only
 * add faces narrower than RELIABLE_FACE_FRACTION × previousTileSide (larger ones were found already), and
 * keepSubjectFaces drops faces narrower than BACKGROUND_FACE_RATIO × the largest face, so once a large face is
 * known the finer passes cannot change the result (e.g. portraits skip the 0.27 grid).
 */
export function finerPassUseful(previousTileSide: number, largestFaceWidth: number): boolean {
  return RELIABLE_FACE_FRACTION * previousTileSide >= BACKGROUND_FACE_RATIO * largestFaceWidth;
}

/** Bounding box of points given as normalized (0...1) coordinates within `tile`, in image pixels. */
export function boxFromTilePoints(points: ReadonlyArray<{ x: number; y: number }>, tile: Tile): Box {
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
  if (!(maxX >= minX && maxY >= minY)) return { x: tile.x, y: tile.y, width: 0, height: 0 };
  return {
    x: tile.x + minX * tile.width,
    y: tile.y + minY * tile.height,
    width: (maxX - minX) * tile.width,
    height: (maxY - minY) * tile.height,
  };
}

/**
 * How far the face box stays from the tile's interior edges (edges that are not also image edges), in units of
 * the face size; Infinity when the tile is the whole image. A face cut by a tile edge has a margin ≤ ~0 and is a
 * partial detection; the same face is fully inside an overlapping tile or a coarser pass.
 */
export function interiorEdgeMargin(box: Box, tile: Tile, imageWidth: number, imageHeight: number): number {
  const size = Math.max(box.width, box.height, 1e-9);
  let margin = Infinity;
  if (tile.x > 0) margin = Math.min(margin, box.x - tile.x);
  if (tile.y > 0) margin = Math.min(margin, box.y - tile.y);
  if (tile.x + tile.width < imageWidth) margin = Math.min(margin, tile.x + tile.width - (box.x + box.width));
  if (tile.y + tile.height < imageHeight) margin = Math.min(margin, tile.y + tile.height - (box.y + box.height));
  return margin / size;
}

export function boxArea(box: Box): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function intersectionArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** Intersection over union, 0...1. */
export function iou(a: Box, b: Box): number {
  const intersection = intersectionArea(a, b);
  const union = boxArea(a) + boxArea(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Intersection over the smaller box's area: 1 when one box contains the other. */
export function overlapOfSmaller(a: Box, b: Box): number {
  const smaller = Math.min(boxArea(a), boxArea(b));
  return smaller > 0 ? intersectionArea(a, b) / smaller : 0;
}

export interface Detection {
  box: Box;
  /** interiorEdgeMargin() of the tile it was found in. */
  margin: number;
}

/** Same face found twice: boxes overlap strongly, or one box sits almost entirely inside the other. */
export function isSameFace(a: Box, b: Box): boolean {
  return iou(a, b) >= 0.3 || overlapOfSmaller(a, b) >= 0.7;
}

/**
 * Collapses detections of the same face from different passes/tiles into one, keeping the best-placed copy:
 * the one farthest from a tile edge (margins beyond half the face size count as equally good), then the larger box.
 * Result order is stable: the kept detections stay in input order.
 */
export function mergeDetections<T extends Detection>(detections: readonly T[]): T[] {
  const ranked = detections
    .map((detection, index) => ({ detection, index }))
    .sort((a, b) => compareQuality(b.detection, a.detection) || a.index - b.index);
  const kept: { detection: T; index: number }[] = [];
  for (const candidate of ranked) {
    if (!kept.some(({ detection }) => isSameFace(detection.box, candidate.detection.box))) kept.push(candidate);
  }
  return kept.sort((a, b) => a.index - b.index).map(({ detection }) => detection);
}

/** Faces narrower than this fraction of the image's long edge are dropped (below the finest pass's detection floor). */
export const MIN_FACE_FRACTION = 0.02;
/** Faces narrower than this fraction of the largest face are bystanders in the background, not subjects. */
export const BACKGROUND_FACE_RATIO = 0.25;

/** Drops implausibly tiny faces and background bystanders (much smaller than the main face). */
export function keepSubjectFaces<T extends { box: Box }>(faces: readonly T[], imageWidth: number, imageHeight: number): T[] {
  const minWidth = MIN_FACE_FRACTION * Math.max(imageWidth, imageHeight);
  const plausible = faces.filter(({ box }) => box.width >= minWidth);
  const largest = Math.max(0, ...plausible.map(({ box }) => box.width));
  return plausible.filter(({ box }) => box.width >= BACKGROUND_FACE_RATIO * largest);
}

function compareQuality(a: Detection, b: Detection): number {
  const marginA = Math.min(a.margin, 0.5);
  const marginB = Math.min(b.margin, 0.5);
  if (marginA !== marginB) return marginA - marginB;
  return boxArea(a.box) - boxArea(b.box);
}
