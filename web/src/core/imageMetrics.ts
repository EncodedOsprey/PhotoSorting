// Pixel-level image quality measurements on 8-bit buffers.
// Port of PhotoSortingCore/Sources/PhotoSortingCore/ImageMetrics.swift (identical math and constants), plus toGrayscale.
import { clamp01 } from './scorer';

/** BT.601 luma (0.299 R + 0.587 G + 0.114 B, rounded) of each pixel of an RGBA buffer; alpha is ignored. */
export function toGrayscale(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`Invalid image size ${width}×${height}`);
  }
  const pixelCount = width * height;
  if (rgba.length < pixelCount * 4) {
    throw new RangeError(`RGBA buffer holds ${rgba.length} values; ${width}×${height} needs ${pixelCount * 4}`);
  }
  const gray = new Uint8Array(pixelCount);
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    gray[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
  }
  return gray;
}

/**
 * Variance of the 3×3 Laplacian (4-neighbour kernel) over an 8-bit grayscale buffer (row-major, width*height).
 * Returns 0 for images smaller than 3×3 or buffers that are too short.
 */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3 || gray.length < width * height) return 0;
  let sum = 0;
  let sumSquares = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let i = row + 1; i < row + width - 1; i++) {
      const laplacian = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += laplacian;
      sumSquares += laplacian * laplacian;
    }
  }
  const n = (width - 2) * (height - 2);
  const mean = sum / n;
  return Math.max(0, sumSquares / n - mean * mean);
}

/** Maps Laplacian variance (computed on ~512px-long-edge images) to 0...1, monotonic, saturating. */
export function sharpnessScore(laplacianVariance: number): number {
  if (!Number.isFinite(laplacianVariance) || laplacianVariance <= 0) return 0;
  const k = 150;
  return laplacianVariance / (laplacianVariance + k);
}

/** Convenience: sharpnessScore(laplacianVariance(gray, width, height)). */
export function sharpnessScoreFromGray(gray: ArrayLike<number>, width: number, height: number): number {
  return sharpnessScore(laplacianVariance(gray, width, height));
}

/**
 * 0...1 exposure quality from grayscale pixels: best when the mean luminance is ~0.45-0.55 of the range,
 * penalizing the fractions of clipped highlights (>= 250) and crushed shadows (<= 5). Empty -> 0.
 */
export function exposureScore(gray: ArrayLike<number>): number {
  const count = gray.length;
  if (count === 0) return 0;
  let sum = 0;
  let clipped = 0;
  let crushed = 0;
  for (let i = 0; i < count; i++) {
    const value = gray[i];
    sum += value;
    if (value >= 250) clipped += 1;
    if (value <= 5) crushed += 1;
  }
  const mean = sum / count / 255;
  // Full credit in 0.45...0.55, linear falloff to 0 at the extremes.
  const distance = Math.max(0, Math.abs(mean - 0.5) - 0.05);
  const meanScore = Math.max(0, 1 - distance / 0.45);
  const clipPenalty = (1.5 * clipped) / count + (1.5 * crushed) / count;
  return clamp01(meanScore - clipPenalty);
}
