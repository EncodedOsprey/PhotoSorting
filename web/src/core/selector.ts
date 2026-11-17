// Picks photos according to a SelectionPlan. Port of PhotoSortingCore/Sources/PhotoSortingCore/PhotoSelector.swift,
// except that near-duplicates are detected pairwise (see selectPhotos).
import { hasClosedEyes, isEligible, scoreFor } from './scorer';
import {
  BLURRY_THRESHOLD,
  CATEGORY_INFO,
  type Candidate,
  type PhotoMetrics,
  type PhotoPick,
  type PlanIssue,
  type SelectionCategory,
  type SelectionPlan,
  type SelectionResult,
  type SelectOptions,
} from './types';

/** Problems with a plan; [] means valid. Selection still behaves sanely for invalid plans. */
export function validatePlan(plan: SelectionPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  // Written as !(>= 1) so NaN and fractional totals below 1 are reported too.
  if (!(plan.totalCount >= 1)) issues.push({ kind: 'totalMustBePositive' });

  const seen = new Set<SelectionCategory>();
  const reportedDuplicates = new Set<SelectionCategory>();
  for (const { category, count } of plan.requests) {
    if (count < 0) issues.push({ kind: 'negativeCount', category });
    if (!seen.has(category)) {
      seen.add(category);
    } else if (!reportedDuplicates.has(category)) {
      reportedDuplicates.add(category);
      issues.push({ kind: 'duplicateCategory', category });
    }
  }

  const requested = requestedCount(plan);
  if (requested > plan.totalCount) {
    issues.push({ kind: 'quotasExceedTotal', requested, total: plan.totalCount });
  }
  return issues;
}

/** Sum of all per-category quotas (negative quotas count as 0). */
export function requestedCount(plan: SelectionPlan): number {
  return plan.requests.reduce((sum, request) => sum + wholeCount(request.count), 0);
}

/** User-facing sentence describing a plan issue. */
export function planIssueMessage(issue: PlanIssue): string {
  switch (issue.kind) {
    case 'totalMustBePositive':
      return 'Total photos must be at least 1.';
    case 'negativeCount':
      return `${CATEGORY_INFO[issue.category].displayName} count can't be negative.`;
    case 'duplicateCategory':
      return `${CATEGORY_INFO[issue.category].displayName} is listed more than once.`;
    case 'quotasExceedTotal':
      return `Category counts add up to ${issue.requested}, which is more than the total of ${issue.total}.`;
  }
}

/**
 * Picks photos for each request in order (earlier requests get first pick), then fills the rest of
 * plan.totalCount with the best remaining photos overall when plan.fillRemainderWithBestOverall is set.
 * A photo is never picked twice and the total is never exceeded; requests that can't be filled are
 * reported in `shortfalls`.
 */
export function selectPhotos<ID>(
  candidates: readonly Candidate<ID>[],
  plan: SelectionPlan,
  options: SelectOptions<ID> = {},
): SelectionResult<ID> {
  const total = wholeCount(plan.totalCount);
  const picks: PhotoPick<ID>[] = [];
  const shortfalls: SelectionResult<ID>['shortfalls'] = {};
  const used = new Uint8Array(candidates.length);
  const passesFilters = candidates.map(({ metrics }) => passesHardFilters(metrics, plan));
  const rankings = new Map<SelectionCategory, RankedCandidate[]>();
  const isNearDuplicate = plan.avoidNearDuplicates ? options.isNearDuplicate : undefined;

  /** Eligible candidates that pass the hard filters, best first (ties keep input order). Computed once per category. */
  const ranking = (category: SelectionCategory): RankedCandidate[] => {
    let ranked = rankings.get(category);
    if (ranked === undefined) {
      ranked = [];
      for (let index = 0; index < candidates.length; index++) {
        const { metrics } = candidates[index];
        if (passesFilters[index] && isEligible(metrics, category)) {
          ranked.push({ index, score: scoreFor(metrics, category) });
        }
      }
      ranked.sort((a, b) => b.score - a.score || a.index - b.index);
      rankings.set(category, ranked);
    }
    return ranked;
  };

  // Near-duplicates are checked pairwise against every photo picked so far. (Swift used transitive
  // clusters, which chain a long run of gradually changing frames into one group and so drop
  // photos that look nothing like the one picked.)
  const duplicatesAPick = (id: ID): boolean =>
    isNearDuplicate !== undefined && picks.some((pick) => isNearDuplicate(id, pick.id));

  const take = (category: SelectionCategory, count: number): number => {
    let taken = 0;
    for (const { index, score } of ranking(category)) {
      if (taken >= count) break;
      if (used[index]) continue;
      const { id } = candidates[index];
      if (duplicatesAPick(id)) continue;
      used[index] = 1;
      picks.push({ id, category, score });
      taken += 1;
    }
    return taken;
  };

  const addShortfall = (category: SelectionCategory, missing: number): void => {
    if (missing > 0) shortfalls[category] = (shortfalls[category] ?? 0) + missing;
  };

  for (const request of plan.requests) {
    const remaining = total - picks.length;
    if (remaining <= 0) break;
    const wanted = Math.min(wholeCount(request.count), remaining);
    if (wanted <= 0) continue;
    addShortfall(request.category, wanted - take(request.category, wanted));
  }

  if (plan.fillRemainderWithBestOverall) {
    const remaining = total - picks.length;
    if (remaining > 0) addShortfall('bestOverall', remaining - take('bestOverall', remaining));
  }

  return { picks, shortfalls };
}

interface RankedCandidate {
  index: number;
  score: number;
}

function passesHardFilters(metrics: PhotoMetrics, plan: SelectionPlan): boolean {
  if (plan.excludeBlurry && metrics.sharpness < BLURRY_THRESHOLD) return false;
  if (plan.excludeClosedEyes && hasClosedEyes(metrics)) return false;
  return true;
}

/** Counts are whole numbers: fractions round down; negative and NaN counts are 0. */
function wholeCount(count: number): number {
  return count > 0 ? Math.floor(count) : 0;
}
