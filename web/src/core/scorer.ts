// Per-category photo scores. Port of PhotoSortingCore/Sources/PhotoSortingCore/Scorer.swift:
// keep the formulas, weights and thresholds identical so the native and web apps pick the same photos.
import { CLOSED_EYES_THRESHOLD, EYES_OPEN_MINIMUM, type FaceMetrics, type PhotoMetrics, type SelectionCategory } from './types';

/** Clamps to 0...1; non-finite values (NaN, ±Infinity) become 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 0...1 score of a photo for a category (higher is better). */
export function scoreFor(metrics: PhotoMetrics, category: SelectionCategory): number {
  const sharp = clamp01(metrics.sharpness);
  const exposure = clamp01(metrics.exposure);
  const { faces } = metrics;

  switch (category) {
    case 'bestSmiles': {
      if (faces.length === 0) return 0;
      const parts: Part[] = [
        [combinedSmile(faces), 0.55],
        [minEyes(faces), 0.25],
        [sharp, 0.1],
      ];
      const quality = meanQuality(faces);
      if (quality !== null) parts.push([quality, 0.1]);
      return weighted(parts);
    }

    case 'eyesOpen': {
      if (faces.length === 0) return 0;
      const parts: Part[] = [
        [minEyes(faces), 0.7],
        [sharp, 0.15],
      ];
      const quality = meanQuality(faces);
      if (quality !== null) parts.push([quality, 0.15]);
      return weighted(parts);
    }

    case 'sharpest':
      return weighted([
        [sharp, 0.85],
        [exposure, 0.15],
      ]);

    case 'wellExposed':
      return weighted([
        [exposure, 0.85],
        [sharp, 0.15],
      ]);

    case 'groupShots': {
      if (faces.length === 0) return 0;
      // Saturating bonus: 3 faces -> ~0.4, 10+ faces -> ~0.8.
      const sizeBonus = clamp01(1 - Math.exp(-faces.length / 6));
      return weighted([
        [minEyes(faces), 0.35],
        [meanSmile(faces), 0.3],
        [sharp, 0.25],
        [sizeBonus, 0.1],
      ]);
    }

    case 'portraits': {
      if (faces.length === 0) return 0;
      const eyes = meanEyes(faces);
      const quality = meanQuality(faces) ?? (eyes === null ? meanSmile(faces) : (meanSmile(faces) + eyes) / 2);
      // Saturates around 25% of the frame.
      const sizeBonus = clamp01(largestFaceArea(faces) / 0.25);
      return weighted([
        [quality, 0.3],
        [minEyes(faces), 0.2],
        [meanSmile(faces), 0.15],
        [sharp, 0.2],
        [sizeBonus, 0.15],
      ]);
    }

    case 'noPeople': {
      const technical = weighted([
        [sharp, 0.5],
        [exposure, 0.5],
      ]);
      if (metrics.aesthetics != null) return clamp01(0.6 * clamp01(metrics.aesthetics) + 0.4 * technical);
      return technical;
    }

    case 'bestOverall':
      return overallScore(metrics);
  }
}

/** Whether a photo can be considered for a category at all. Utility photos (screenshots, documents) never are. */
export function isEligible(metrics: PhotoMetrics, category: SelectionCategory): boolean {
  if (metrics.isUtility) return false;
  const faceCount = metrics.faces.length;

  switch (category) {
    case 'bestSmiles':
      return faceCount >= 1;
    case 'eyesOpen':
      return (
        faceCount >= 1 &&
        metrics.faces.every((face) => hasVisibleEyes(face) && clamp01(face.eyesOpen) >= EYES_OPEN_MINIMUM)
      );
    case 'groupShots':
      return faceCount >= 3;
    case 'portraits': {
      if (faceCount < 1 || faceCount > 2) return false;
      let largest = 0;
      for (const face of metrics.faces) largest = Math.max(largest, face.areaFraction);
      return largest >= 0.02;
    }
    case 'noPeople':
      return faceCount === 0;
    case 'sharpest':
    case 'wellExposed':
    case 'bestOverall':
      return true;
  }
}

/** Whether any face has closed eyes (the plan's "skip closed eyes" filter); hidden eyes don't count as closed. */
export function hasClosedEyes(metrics: PhotoMetrics): boolean {
  return metrics.faces.some((face) => hasVisibleEyes(face) && face.eyesOpen < CLOSED_EYES_THRESHOLD);
}

/** 0...1 general quality score (used by 'bestOverall'). */
export function overallScore(metrics: PhotoMetrics): number {
  const parts: Part[] = [
    [clamp01(metrics.sharpness), 0.3],
    [clamp01(metrics.exposure), 0.2],
  ];
  if (metrics.aesthetics != null) parts.push([clamp01(metrics.aesthetics), 0.25]);
  const { faces } = metrics;
  if (faces.length > 0) {
    parts.push([combinedSmile(faces), 0.1]);
    parts.push([minEyes(faces), 0.15]);
    const quality = meanQuality(faces);
    if (quality !== null) parts.push([quality, 0.1]);
  }
  return weighted(parts);
}

// MARK: - Helpers

/** A score component; a null value (signal unavailable) is left out. */
type Part = readonly [value: number | null, weight: number];

/** Weighted mean with weights renormalized over the available components. */
function weighted(parts: readonly Part[]): number {
  let totalWeight = 0;
  let sum = 0;
  for (const [value, weight] of parts) {
    if (value === null) continue;
    totalWeight += weight;
    sum += clamp01(value) * weight;
  }
  return totalWeight > 0 ? clamp01(sum / totalWeight) : 0;
}

/** One non-smiler drags the photo down: mostly the weakest smile, partly the average. */
function combinedSmile(faces: readonly FaceMetrics[]): number {
  return 0.6 * minSmile(faces) + 0.4 * meanSmile(faces);
}

function minSmile(faces: readonly FaceMetrics[]): number {
  return minimum(faces, (face) => face.smile);
}

function meanSmile(faces: readonly FaceMetrics[]): number {
  return mean(faces, (face) => face.smile);
}

/** Weakest eyes among the faces whose eyes are visible; null when no face's are. */
function minEyes(faces: readonly FaceMetrics[]): number | null {
  const visible = faces.filter(hasVisibleEyes);
  return visible.length > 0 ? minimum(visible, (face) => face.eyesOpen) : null;
}

/** Mean eyes over the faces whose eyes are visible; null when no face's are. */
function meanEyes(faces: readonly FaceMetrics[]): number | null {
  const visible = faces.filter(hasVisibleEyes);
  return visible.length > 0 ? mean(visible, (face) => face.eyesOpen) : null;
}

function hasVisibleEyes(face: FaceMetrics): boolean {
  return face.eyesVisible !== false;
}

function largestFaceArea(faces: readonly FaceMetrics[]): number {
  let largest = 0;
  for (const face of faces) largest = Math.max(largest, clamp01(face.areaFraction));
  return largest;
}

/** Mean capture quality over the faces that have one; null when none do. */
function meanQuality(faces: readonly FaceMetrics[]): number | null {
  let sum = 0;
  let count = 0;
  for (const { captureQuality } of faces) {
    if (captureQuality == null) continue;
    sum += clamp01(captureQuality);
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

/** Minimum of the clamped values; 0 for no faces. */
function minimum(faces: readonly FaceMetrics[], value: (face: FaceMetrics) => number): number {
  if (faces.length === 0) return 0;
  let result = Infinity;
  for (const face of faces) result = Math.min(result, clamp01(value(face)));
  return result;
}

/** Mean of the clamped values; 0 for no faces. */
function mean(faces: readonly FaceMetrics[], value: (face: FaceMetrics) => number): number {
  if (faces.length === 0) return 0;
  let sum = 0;
  for (const face of faces) sum += clamp01(value(face));
  return sum / faces.length;
}
