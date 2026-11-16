import { describe, expect, it } from 'vitest';
import { planIssueMessage, requestedCount, selectPhotos, validatePlan } from './selector';
import type { Candidate, FaceMetrics, SelectionCategory, SelectionPlan, SelectionResult } from './types';

const face = (overrides: Partial<FaceMetrics> = {}): FaceMetrics => ({
  smile: 0.8,
  eyesOpen: 0.9,
  captureQuality: null,
  areaFraction: 0.05,
  ...overrides,
});

const photo = (id: number, { faces = [] as FaceMetrics[], sharp = 0.7, exposure = 0.7 } = {}): Candidate<number> => ({
  id,
  metrics: { faces, sharpness: sharp, exposure, aesthetics: null, isUtility: false },
});

/** Same defaults as the Swift SelectionPlan initializer. */
const plan = (overrides: Partial<SelectionPlan> = {}): SelectionPlan => ({
  totalCount: 1,
  requests: [],
  fillRemainderWithBestOverall: true,
  avoidNearDuplicates: true,
  excludeBlurry: true,
  excludeClosedEyes: false,
  ...overrides,
});

const ids = (result: SelectionResult<number>) => result.picks.map((pick) => pick.id);
const picksFor = (result: SelectionResult<number>, category: SelectionCategory) =>
  result.picks.filter((pick) => pick.category === category);

/** A symmetric near-duplicate predicate from explicit pairs. */
const nearDuplicates = (...pairs: [number, number][]) => {
  const keys = new Set(pairs.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  return (a: number, b: number) => keys.has(`${a}|${b}`);
};

describe('validatePlan', () => {
  it('accepts a valid plan', () => {
    const valid = plan({ totalCount: 5, requests: [{ category: 'sharpest', count: 2 }, { category: 'bestSmiles', count: 3 }] });
    expect(validatePlan(valid)).toEqual([]);
  });

  it('reports every issue', () => {
    expect(validatePlan(plan({ totalCount: 0 }))).toContainEqual({ kind: 'totalMustBePositive' });
    const issues = validatePlan(
      plan({
        totalCount: 3,
        requests: [
          { category: 'sharpest', count: -1 },
          { category: 'bestSmiles', count: 2 },
          { category: 'bestSmiles', count: 2 },
          { category: 'bestSmiles', count: 0 },
        ],
      }),
    );
    expect(issues).toEqual([
      { kind: 'negativeCount', category: 'sharpest' },
      { kind: 'duplicateCategory', category: 'bestSmiles' },
      { kind: 'quotasExceedTotal', requested: 4, total: 3 },
    ]);
  });

  it('counts only non-negative quotas', () => {
    const quotas = plan({ requests: [{ category: 'sharpest', count: -2 }, { category: 'portraits', count: 2 }, { category: 'noPeople', count: 5 }] });
    expect(requestedCount(quotas)).toBe(7);
  });

  it('describes issues in user-facing sentences', () => {
    expect(planIssueMessage({ kind: 'totalMustBePositive' })).toBe('Total photos must be at least 1.');
    expect(planIssueMessage({ kind: 'negativeCount', category: 'sharpest' })).toBe("Sharpest Focus count can't be negative.");
    expect(planIssueMessage({ kind: 'duplicateCategory', category: 'noPeople' })).toBe('Scenery & Details is listed more than once.');
    expect(planIssueMessage({ kind: 'quotasExceedTotal', requested: 4, total: 3 })).toBe(
      'Category counts add up to 4, which is more than the total of 3.',
    );
  });
});

describe('selectPhotos', () => {
  it('respects per-category counts and the total, never picking a photo twice', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => photo(i, { faces: i % 2 === 0 ? [face()] : [], sharp: 0.3 + i * 0.03 }));
    const result = selectPhotos(
      candidates,
      plan({ totalCount: 8, requests: [{ category: 'sharpest', count: 3 }, { category: 'noPeople', count: 2 }] }),
    );
    expect(result.picks).toHaveLength(8);
    expect(picksFor(result, 'sharpest').map((pick) => pick.id)).toEqual([19, 18, 17]);
    expect(picksFor(result, 'noPeople')).toHaveLength(2);
    expect(picksFor(result, 'bestOverall')).toHaveLength(3);
    expect(new Set(ids(result)).size).toBe(8);
    expect(result.shortfalls).toEqual({});
  });

  it('gives earlier requests first pick', () => {
    const candidates = [photo(0, { sharp: 0.9 }), photo(1, { sharp: 0.5 })];
    const result = selectPhotos(
      candidates,
      plan({ totalCount: 2, requests: [{ category: 'noPeople', count: 1 }, { category: 'sharpest', count: 1 }], fillRemainderWithBestOverall: false }),
    );
    expect(ids(result)).toEqual([0, 1]);
    expect(result.picks.map((pick) => pick.category)).toEqual(['noPeople', 'sharpest']);
  });

  it('reports shortfalls and fills the remainder with the best overall photos', () => {
    const candidates = [photo(0), photo(1), photo(2, { faces: [face()] })];
    const result = selectPhotos(candidates, plan({ totalCount: 5, requests: [{ category: 'groupShots', count: 2 }] }));
    expect(result.shortfalls).toEqual({ groupShots: 2, bestOverall: 2 });
    expect(picksFor(result, 'bestOverall')).toHaveLength(3);
  });

  it('leaves the remainder empty when filling is off', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => photo(i));
    const result = selectPhotos(
      candidates,
      plan({ totalCount: 4, requests: [{ category: 'sharpest', count: 1 }], fillRemainderWithBestOverall: false }),
    );
    expect(result.picks).toHaveLength(1);
  });

  it('applies the hard filters', () => {
    const candidates = [
      photo(0, { sharp: 0.1 }),
      photo(1, { faces: [face({ eyesOpen: 0.1 })], sharp: 0.95 }),
      photo(2, { faces: [face({ eyesOpen: 0.9 })], sharp: 0.6 }),
    ];
    expect(ids(selectPhotos(candidates, plan({ totalCount: 3, excludeBlurry: true, excludeClosedEyes: true })))).toEqual([2]);
    const lenient = plan({ totalCount: 3, excludeBlurry: false, excludeClosedEyes: false });
    expect(selectPhotos(candidates, lenient).picks).toHaveLength(3);
  });

  it('never exceeds the total for invalid plans', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => photo(i));
    const result = selectPhotos(
      candidates,
      plan({
        totalCount: 3,
        requests: [
          { category: 'sharpest', count: -2 },
          { category: 'wellExposed', count: 2 },
          { category: 'sharpest', count: 5 },
        ],
      }),
    );
    expect(result.picks).toHaveLength(3);
    expect(picksFor(result, 'wellExposed')).toHaveLength(2);
    expect(picksFor(result, 'sharpest')).toHaveLength(1);
    expect(selectPhotos(candidates, plan({ totalCount: -1 })).picks).toEqual([]);
  });

  it('counts a shortfall only against what still fit in the total', () => {
    const candidates = Array.from({ length: 4 }, (_, i) => photo(i));
    const result = selectPhotos(
      candidates,
      plan({ totalCount: 3, requests: [{ category: 'sharpest', count: 2 }, { category: 'groupShots', count: 5 }] }),
    );
    expect(result.shortfalls).toEqual({ groupShots: 1 });
    expect(picksFor(result, 'bestOverall')).toHaveLength(1);
  });

  describe('near-duplicate avoidance', () => {
    it('skips photos that are near-duplicates of a pick', () => {
      const candidates = [photo(0, { sharp: 0.9 }), photo(1, { sharp: 0.8 }), photo(2, { sharp: 0.5 })];
      const sharpest = plan({ totalCount: 2, requests: [{ category: 'sharpest', count: 2 }] });
      const options = { isNearDuplicate: nearDuplicates([0, 1]) };
      expect(ids(selectPhotos(candidates, sharpest, options))).toEqual([0, 2]);
      expect(ids(selectPhotos(candidates, { ...sharpest, avoidNearDuplicates: false }, options))).toEqual([0, 1]);
    });

    it('compares pairwise, without chaining similar photos together', () => {
      // A~B and B~C, but A and C are distinct; B ranks last.
      const [a, b, c] = [0, 1, 2];
      const candidates = [photo(a, { sharp: 0.9 }), photo(b, { sharp: 0.5 }), photo(c, { sharp: 0.8 })];
      const options = { isNearDuplicate: nearDuplicates([a, b], [b, c]) };
      const sharpest = plan({ totalCount: 3, requests: [{ category: 'sharpest', count: 3 }], fillRemainderWithBestOverall: false });

      const result = selectPhotos(candidates, sharpest, options);
      expect(ids(result)).toEqual([a, c]);
      expect(result.shortfalls).toEqual({ sharpest: 1 });

      expect(ids(selectPhotos(candidates, { ...sharpest, avoidNearDuplicates: false }, options))).toEqual([a, c, b]);
    });

    it('applies across categories and the remainder fill', () => {
      const candidates = [
        photo(0, { faces: [face()], sharp: 0.9 }),
        photo(1, { sharp: 0.85 }),
        photo(2, { sharp: 0.6 }),
        photo(3, { sharp: 0.8 }),
      ];
      const result = selectPhotos(
        candidates,
        plan({ totalCount: 3, requests: [{ category: 'sharpest', count: 1 }, { category: 'noPeople', count: 1 }] }),
        { isNearDuplicate: nearDuplicates([0, 1], [2, 3], [0, 3]) },
      );
      expect(result.picks.map(({ id, category }) => [id, category])).toEqual([
        [0, 'sharpest'],
        [2, 'noPeople'],
      ]);
      expect(result.shortfalls).toEqual({ bestOverall: 1 });
    });

    it('never calls the predicate when avoidance is off', () => {
      let calls = 0;
      const isNearDuplicate = () => {
        calls += 1;
        return true;
      };
      const candidates = Array.from({ length: 5 }, (_, i) => photo(i));
      const result = selectPhotos(candidates, plan({ totalCount: 5, avoidNearDuplicates: false }), { isNearDuplicate });
      expect(result.picks).toHaveLength(5);
      expect(calls).toBe(0);
    });

    it('only checks qualifying candidates and stops once a quota is met', () => {
      // 3,000 photos, half of them blurry; 100 picks with a predicate that never matches.
      const candidates = Array.from({ length: 3000 }, (_, i) => photo(i, { sharp: i % 2 === 0 ? 0.3 + (i / 3000) * 0.7 : 0.1 }));
      const checked = new Set<number>();
      let calls = 0;
      const isNearDuplicate = (id: number) => {
        calls += 1;
        checked.add(id);
        return false;
      };
      const result = selectPhotos(candidates, plan({ totalCount: 100, requests: [{ category: 'sharpest', count: 100 }] }), {
        isNearDuplicate,
      });
      expect(result.picks).toHaveLength(100);
      expect(calls).toBe((99 * 100) / 2);
      expect([...checked].every((id) => id % 2 === 0)).toBe(true);
    });
  });
});
