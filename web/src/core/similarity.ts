// Near-duplicate detection: a tiny colour-layout descriptor per photo, compared pairwise.
import type { SimilarityItem } from './types';

// Thresholds on descriptorDistance() for looseness 0 ("only near-identical shots") and 1 ("anything from
// the same scene"); the default looseness 0.5 gives 0.115. PROVISIONAL: calibrated on synthetic 320×240
// photos only (similarity.test.ts generator: smooth backdrop, objects, a person; 24 seeds), which measured
//   exposure ×0.8/×1.2, contrast ×0.7/×1.3        ≤ 0.0004
//   camera shift 2%                                ≤ 0.019   (median 0.013)  → STRICT 0.03
//   shift 5% / head moves (~3%) / new object (7%)  ≤ 0.090 / 0.063 / 0.079   → default 0.115
//   zoom 10%                                       ≤ 0.041
//   same backdrop, different 26–35% subject        ≥ 0.196   (median 0.37)   → default 0.115
//   unrelated scenes                               ≥ 0.274   (median 0.50)   → LOOSE 0.2
// Busier synthetic scenes (many small high-contrast objects) reached 0.10 for 5% shifts and went down to
// 0.24 for unrelated scenes. Re-calibrate on real photos.
export const NEAR_DUPLICATE_THRESHOLD_STRICT = 0.03;
export const NEAR_DUPLICATE_THRESHOLD_LOOSE = 0.2;

/** The descriptor is a DESCRIPTOR_GRID × DESCRIPTOR_GRID thumbnail per R, G, B channel. */
export const DESCRIPTOR_GRID = 16;

const CHANNELS = 3;
/** Standard deviation (in 0...255 pixel units) below which an image counts as flat. */
const FLAT_STD = 1e-6;
/** Photos whose aspect ratios differ by more than this factor are framed differently (e.g. portrait vs landscape). */
const MAX_ASPECT_RATIO_CHANGE = 1.15;

/**
 * Colour-layout descriptor: the RGBA image area-averaged down to a 16×16 grid per R, G, B channel
 * (aspect ratio ignored), then standardized over all 768 values (zero mean, unit variance) so it is
 * insensitive to exposure and contrast changes such as bracketing. A flat image yields all zeros.
 */
export function computeDescriptor(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid image size ${width}×${height}`);
  }
  if (rgba.length < width * height * 4) {
    throw new RangeError(`RGBA buffer holds ${rgba.length} values; ${width}×${height} needs ${width * height * 4}`);
  }
  const grid = DESCRIPTOR_GRID;
  const columns = areaWeights(width, grid);
  const rows = areaWeights(height, grid);
  const rowCells = new Float64Array(grid * CHANNELS);
  const cells = new Float64Array(grid * grid * CHANNELS);

  for (let y = 0; y < height; y++) {
    // Horizontal pass: average this pixel row into the grid columns.
    rowCells.fill(0);
    for (let x = 0, p = y * width * 4; x < width; x++, p += 4) {
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      for (let k = columns.offsets[x]; k < columns.offsets[x + 1]; k++) {
        const weight = columns.weights[k];
        const c = columns.cells[k] * CHANNELS;
        rowCells[c] += weight * r;
        rowCells[c + 1] += weight * g;
        rowCells[c + 2] += weight * b;
      }
    }
    // Vertical pass: add the row into the grid rows it overlaps.
    for (let k = rows.offsets[y]; k < rows.offsets[y + 1]; k++) {
      const weight = rows.weights[k];
      const base = rows.cells[k] * grid * CHANNELS;
      for (let i = 0; i < rowCells.length; i++) cells[base + i] += weight * rowCells[i];
    }
  }
  return standardize(cells);
}

/**
 * 0 for identical descriptors ... 0.5 for unrelated ones ... 1 for inverted ones: (1 − Pearson correlation) / 2.
 * A flat image (all-zero descriptor) is identical to another flat image and unrelated (1) to anything else.
 */
export function descriptorDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new RangeError(`Descriptor lengths differ: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return normA === normB ? 0 : 1;
  // For standardized descriptors this is dot / length, i.e. the Pearson correlation; dividing by the actual
  // norms keeps identical descriptors at exactly 0 despite Float32 rounding.
  const correlation = dot / Math.sqrt(normA * normB);
  return Math.min(1, Math.max(0, (1 - correlation) / 2));
}

/** Distance threshold for a looseness in 0...1 (0 = only near-identical shots, 1 = anything from the same scene). */
export function nearDuplicateThreshold(looseness: number): number {
  const t = Number.isNaN(looseness) ? 0.5 : Math.min(1, Math.max(0, looseness));
  return NEAR_DUPLICATE_THRESHOLD_STRICT + (NEAR_DUPLICATE_THRESHOLD_LOOSE - NEAR_DUPLICATE_THRESHOLD_STRICT) * t;
}

export interface NearDuplicateCheckerOptions {
  /** Photos whose capture times are both known and further apart than this are never near-duplicates. Default 180. */
  maxSeconds?: number;
  /** Otherwise, photos further apart than this in the order they were added are never near-duplicates. Default 30. */
  maxOrderGap?: number;
}

/**
 * Returns a symmetric predicate telling whether two photos are near-duplicates: same id; or same framing
 * (aspect ratio), taken close together, and descriptorDistance <= threshold. Unknown ids are never
 * near-duplicates of anything else. Distances are computed lazily and cached per pair.
 */
export function createNearDuplicateChecker<ID>(
  items: readonly SimilarityItem<ID>[],
  threshold: number,
  { maxSeconds = 180, maxOrderGap = 30 }: NearDuplicateCheckerOptions = {},
): (a: ID, b: ID) => boolean {
  const indexById = new Map<ID, number>();
  items.forEach((item, index) => indexById.set(item.id, index));
  const distances = new Map<number, number>();

  const closeInTime = (a: SimilarityItem<ID>, b: SimilarityItem<ID>): boolean => {
    const timeA = captureTime(a);
    const timeB = captureTime(b);
    if (timeA !== null && timeB !== null) return Math.abs(timeA - timeB) <= maxSeconds * 1000;
    return Math.abs(a.order - b.order) <= maxOrderGap;
  };

  const distance = (i: number, j: number): number => {
    const key = Math.min(i, j) * items.length + Math.max(i, j);
    let d = distances.get(key);
    if (d === undefined) {
      d = descriptorDistance(items[i].descriptor, items[j].descriptor);
      distances.set(key, d);
    }
    return d;
  };

  return (a, b) => {
    if (a === b) return true;
    const i = indexById.get(a);
    const j = indexById.get(b);
    if (i === undefined || j === undefined) return false;
    if (i === j) return true;
    const itemA = items[i];
    const itemB = items[j];
    return sameFraming(itemA.aspect, itemB.aspect) && closeInTime(itemA, itemB) && distance(i, j) <= threshold;
  };
}

function captureTime(item: SimilarityItem<unknown>): number | null {
  return Number.isFinite(item.capturedAt) ? item.capturedAt : null;
}

function sameFraming(aspectA: number, aspectB: number): boolean {
  // Phrased so that NaN (unknown or zero aspect) fails the check.
  return Math.max(aspectA, aspectB) / Math.min(aspectA, aspectB) <= MAX_ASPECT_RATIO_CHANGE;
}

interface AxisWeights {
  /** Pixel p contributes to the cells listed at offsets[p] ..< offsets[p + 1]. */
  offsets: Int32Array;
  cells: Int32Array;
  weights: Float64Array;
}

/**
 * Area-averaging weights from `size` pixels onto `cellCount` equal cells, with fractional pixel coverage.
 * Coordinates are scaled by cellCount (pixel p spans [p·cellCount, (p+1)·cellCount), cell c spans
 * [c·size, (c+1)·size)) so all boundaries are integers; each cell's weights sum to exactly 1.
 */
function areaWeights(size: number, cellCount: number): AxisWeights {
  const offsets = new Int32Array(size + 1);
  const cells: number[] = [];
  const weights: number[] = [];
  for (let p = 0; p < size; p++) {
    const start = p * cellCount;
    const end = start + cellCount;
    for (let c = Math.floor(start / size); c < cellCount && c * size < end; c++) {
      const overlap = Math.min(end, (c + 1) * size) - Math.max(start, c * size);
      if (overlap > 0) {
        cells.push(c);
        weights.push(overlap / size);
      }
    }
    offsets[p + 1] = cells.length;
  }
  return { offsets, cells: Int32Array.from(cells), weights: Float64Array.from(weights) };
}

/** (value − mean) / standard deviation over all values; all zeros for a flat input. */
function standardize(values: Float64Array): Float32Array {
  const n = values.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (values[i] - mean) ** 2;
  const std = Math.sqrt(variance / n);

  const result = new Float32Array(n);
  if (std < FLAT_STD) return result;
  for (let i = 0; i < n; i++) result[i] = (values[i] - mean) / std;
  return result;
}
