// Runs the selector over analyzed photos, and ranks alternatives for a pick in the detail sheet.
import { createNearDuplicateChecker, isEligible, nearDuplicateThreshold, scoreFor, selectPhotos } from '../../core';
import {
  BLURRY_THRESHOLD,
  CLOSED_EYES_THRESHOLD,
  type PhotoMetrics,
  type SelectionCategory,
  type SelectionPlan,
  type SelectionResult,
  type SimilarityItem,
} from '../../core/types';

/** The parts of an analyzed photo selection needs. */
export interface SelectablePhoto {
  key: string;
  metrics: PhotoMetrics;
  order: number;
  capturedAt: number | null;
  width: number;
  height: number;
  descriptor: Float32Array;
}

export type NearDuplicatePredicate = (a: string, b: string) => boolean;

export interface SelectionRun {
  result: SelectionResult<string>;
  /** Present when near-duplicate avoidance is on. */
  isNearDuplicate?: NearDuplicatePredicate;
}

export function similarityItems(photos: readonly SelectablePhoto[]): SimilarityItem<string>[] {
  return photos.map((photo) => ({
    id: photo.key,
    capturedAt: photo.capturedAt,
    order: photo.order,
    aspect: photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1,
    descriptor: photo.descriptor,
  }));
}

export function runSelection(photos: readonly SelectablePhoto[], plan: SelectionPlan, looseness: number): SelectionRun {
  const candidates = photos.map((photo) => ({ id: photo.key, metrics: photo.metrics }));
  if (!plan.avoidNearDuplicates) return { result: selectPhotos(candidates, plan) };
  const isNearDuplicate = createNearDuplicateChecker(similarityItems(photos), nearDuplicateThreshold(looseness));
  return { result: selectPhotos(candidates, plan, { isNearDuplicate }), isNearDuplicate };
}

/** The plan's "skip blurry" and "skip closed eyes" filters. */
export function passesHardFilters(metrics: PhotoMetrics, plan: Pick<SelectionPlan, 'excludeBlurry' | 'excludeClosedEyes'>): boolean {
  if (plan.excludeBlurry && metrics.sharpness < BLURRY_THRESHOLD) return false;
  if (plan.excludeClosedEyes && metrics.faces.some((face) => face.eyesOpen < CLOSED_EYES_THRESHOLD)) return false;
  return true;
}

/** Keys of the photos that qualify for `category` and pass the plan's hard filters. */
export function eligibleKeys(
  photos: readonly Pick<SelectablePhoto, 'key' | 'metrics'>[],
  category: SelectionCategory,
  plan: Pick<SelectionPlan, 'excludeBlurry' | 'excludeClosedEyes'>,
): Set<string> {
  const keys = new Set<string>();
  for (const photo of photos) {
    if (passesHardFilters(photo.metrics, plan) && isEligible(photo.metrics, category)) keys.add(photo.key);
  }
  return keys;
}

export interface RankedAlternative<T> {
  photo: T;
  score: number;
}

/** The best photos for `category` that aren't picked yet and pass the plan's hard filters, best first. */
export function rankAlternatives<T extends Pick<SelectablePhoto, 'key' | 'metrics' | 'order'>>(
  photos: readonly T[],
  category: SelectionCategory,
  excludeKeys: ReadonlySet<string>,
  plan: Pick<SelectionPlan, 'excludeBlurry' | 'excludeClosedEyes'>,
  limit = 6,
): RankedAlternative<T>[] {
  const ranked: RankedAlternative<T>[] = [];
  for (const photo of photos) {
    if (excludeKeys.has(photo.key)) continue;
    if (!passesHardFilters(photo.metrics, plan) || !isEligible(photo.metrics, category)) continue;
    ranked.push({ photo, score: scoreFor(photo.metrics, category) });
  }
  ranked.sort((a, b) => b.score - a.score || a.photo.order - b.photo.order);
  return ranked.slice(0, Math.max(0, limit));
}
