// Shared domain types for PhotoSorting's selection engine.
// TypeScript port of PhotoSortingCore/Sources/PhotoSortingCore/Models.swift, kept platform independent:
// nothing in src/core may touch the DOM, so it runs (and is unit tested) under Node.

export const SELECTION_CATEGORIES = [
  'bestSmiles',
  'eyesOpen',
  'sharpest',
  'wellExposed',
  'groupShots',
  'portraits',
  'noPeople',
  'bestOverall',
] as const;

/** A kind of "best photo" the photographer can ask for. */
export type SelectionCategory = (typeof SELECTION_CATEGORIES)[number];

export interface CategoryInfo {
  displayName: string;
  summary: string;
}

export const CATEGORY_INFO: Readonly<Record<SelectionCategory, CategoryInfo>> = {
  bestSmiles: { displayName: 'Best Smiles', summary: 'Everyone smiling, with eyes open.' },
  eyesOpen: { displayName: 'Eyes Open', summary: 'No blinks or sunglasses — every face has open eyes.' },
  sharpest: { displayName: 'Sharpest Focus', summary: 'Crisp focus with no motion blur.' },
  wellExposed: { displayName: 'Best Exposure', summary: 'Balanced brightness, no blown highlights or crushed shadows.' },
  groupShots: { displayName: 'Group Shots', summary: 'Three or more people, all looking good.' },
  portraits: { displayName: 'Portraits', summary: 'One or two people, close up, high face quality.' },
  noPeople: { displayName: 'Scenery & Details', summary: 'Venue, decor, detail and landscape shots without faces.' },
  bestOverall: { displayName: 'Best Overall', summary: 'Highest combined quality score.' },
};

/** Per-face measurements. All scores are normalized to 0...1. */
export interface FaceMetrics {
  smile: number;
  eyesOpen: number;
  /** False when the eyes are hidden (sunglasses): eyesOpen then means nothing and is ignored. Absent means true. */
  eyesVisible?: boolean;
  /** Face capture quality (sharpness, pose, size of the face) 0...1; null when unavailable. */
  captureQuality: number | null;
  /** Fraction of the image area covered by the face bounding box (0...1). */
  areaFraction: number;
}

/** Measurements for a single photo. All scores are normalized to 0...1. */
export interface PhotoMetrics {
  faces: FaceMetrics[];
  sharpness: number;
  exposure: number;
  /** Aesthetics score 0...1; null when unavailable (the web engine does not compute one). */
  aesthetics: number | null;
  /** True for screenshots, receipts, documents etc. Utility photos are never selected. */
  isUtility: boolean;
}

/** A photo ready for selection. */
export interface Candidate<ID> {
  id: ID;
  metrics: PhotoMetrics;
}

export interface SelectionRequest {
  category: SelectionCategory;
  count: number;
}

export interface SelectionPlan {
  /** Total number of photos the photographer wants delivered. */
  totalCount: number;
  /** Ordered per-category quotas; earlier requests get first pick. */
  requests: SelectionRequest[];
  /** Fill (totalCount - sum of quotas) with the best remaining photos by overall score. */
  fillRemainderWithBestOverall: boolean;
  /** Never pick a photo that is a near-duplicate of one already picked (needs SelectOptions.isNearDuplicate). */
  avoidNearDuplicates: boolean;
  /** Skip photos whose sharpness is below BLURRY_THRESHOLD. */
  excludeBlurry: boolean;
  /** Skip photos where any face with visible eyes has eyesOpen below CLOSED_EYES_THRESHOLD. */
  excludeClosedEyes: boolean;
}

export const BLURRY_THRESHOLD = 0.25;
export const CLOSED_EYES_THRESHOLD = 0.3;
/** 'eyesOpen' only considers photos where every face's eyes are visible and score at least this. */
export const EYES_OPEN_MINIMUM = 0.5;

export type PlanIssue =
  | { kind: 'totalMustBePositive' }
  | { kind: 'negativeCount'; category: SelectionCategory }
  | { kind: 'duplicateCategory'; category: SelectionCategory }
  /** Category quotas add up to more than the total. */
  | { kind: 'quotasExceedTotal'; requested: number; total: number };

/** One selected photo. (Named PhotoPick to avoid clashing with TypeScript's built-in Pick type.) */
export interface PhotoPick<ID> {
  id: ID;
  /** The category this photo was picked for ('bestOverall' for remainder fill). */
  category: SelectionCategory;
  /** The category score, 0...1. */
  score: number;
}

export interface SelectionResult<ID> {
  /** Picks in order: each request's picks (best first), then the remainder fill. */
  picks: PhotoPick<ID>[];
  /** Categories that couldn't be filled, mapped to how many photos were missing. */
  shortfalls: Partial<Record<SelectionCategory, number>>;
}

export interface SelectOptions<ID> {
  /** True when two photos are near-duplicates (same moment). Used when plan.avoidNearDuplicates is set. */
  isNearDuplicate?: (a: ID, b: ID) => boolean;
}

/** Input for near-duplicate detection (see src/core/similarity.ts). */
export interface SimilarityItem<ID> {
  id: ID;
  /** Capture time in ms since epoch (EXIF DateTimeOriginal), or null when unknown. */
  capturedAt: number | null;
  /** Position in the order the photographer added the photos (used when capture times are unknown). */
  order: number;
  /** Width / height of the oriented image. */
  aspect: number;
  /** Output of computeDescriptor(). */
  descriptor: Float32Array;
}

/*
 * Functions implemented in src/core (exported from src/core/index.ts):
 *
 *   scorer.ts      scoreFor(metrics, category): number            0...1, higher is better
 *                  isEligible(metrics, category): boolean
 *                  overallScore(metrics): number                   0...1
 *   selector.ts    validatePlan(plan): PlanIssue[]                 [] means valid
 *                  requestedCount(plan): number                    sum of non-negative quotas
 *                  planIssueMessage(issue): string                 user-facing sentence
 *                  selectPhotos<ID>(candidates, plan, options?): SelectionResult<ID>
 *   imageMetrics.ts toGrayscale(rgba, width, height): Uint8Array   BT.601 luma from RGBA bytes
 *                  laplacianVariance(gray, width, height): number
 *                  sharpnessScore(laplacianVariance): number       0...1 (for ~512px long-edge images)
 *                  exposureScore(gray): number                     0...1
 *   similarity.ts  computeDescriptor(rgba, width, height): Float32Array
 *                  descriptorDistance(a, b): number                0 identical ... 1 unrelated
 *                  nearDuplicateThreshold(looseness): number       looseness 0 = only near-identical, 1 = same scene
 *                  createNearDuplicateChecker<ID>(items, threshold, options?): (a: ID, b: ID) => boolean
 */
