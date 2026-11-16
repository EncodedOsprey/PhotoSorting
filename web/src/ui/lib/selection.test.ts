import { describe, expect, it } from 'vitest';
import type { FaceMetrics, PhotoMetrics, SelectionPlan } from '../../core/types';
import { passesHardFilters, rankAlternatives, runSelection, similarityItems, type SelectablePhoto } from './selection';

const face = (smile: number, eyesOpen = 0.9): FaceMetrics => ({ smile, eyesOpen, captureQuality: 0.8, areaFraction: 0.08 });
const metrics = (faces: FaceMetrics[], sharpness = 0.8): PhotoMetrics => ({ faces, sharpness, exposure: 0.8, aesthetics: null, isUtility: false });

const photo = (key: string, m: PhotoMetrics, order: number, descriptor = [order, 0, 0, 0]): SelectablePhoto => ({
  key,
  metrics: m,
  order,
  capturedAt: 1_000_000 + order * 1000,
  width: 4000,
  height: 3000,
  descriptor: Float32Array.from(descriptor),
});

const plan = (overrides: Partial<SelectionPlan> = {}): SelectionPlan => ({
  totalCount: 3,
  requests: [{ category: 'bestSmiles', count: 2 }],
  fillRemainderWithBestOverall: true,
  avoidNearDuplicates: false,
  excludeBlurry: true,
  excludeClosedEyes: false,
  ...overrides,
});

describe('passesHardFilters', () => {
  it('applies the skip blurry and skip closed eyes options', () => {
    const blurry = metrics([face(0.5)], 0.1);
    const blink = metrics([face(0.9), face(0.9, 0.1)]);
    expect(passesHardFilters(blurry, { excludeBlurry: true, excludeClosedEyes: false })).toBe(false);
    expect(passesHardFilters(blurry, { excludeBlurry: false, excludeClosedEyes: true })).toBe(true);
    expect(passesHardFilters(blink, { excludeBlurry: true, excludeClosedEyes: true })).toBe(false);
    expect(passesHardFilters(blink, { excludeBlurry: true, excludeClosedEyes: false })).toBe(true);
  });
});

describe('rankAlternatives', () => {
  const photos = [
    photo('picked', metrics([face(0.95)]), 0),
    photo('good', metrics([face(0.8)]), 1),
    photo('better', metrics([face(0.9)]), 2),
    photo('blurry', metrics([face(1)], 0.05), 3),
    photo('scenery', metrics([]), 4),
    photo('ok', metrics([face(0.4)]), 5),
  ];

  it('ranks unpicked, eligible photos that pass the filters, best first', () => {
    const ranked = rankAlternatives(photos, 'bestSmiles', new Set(['picked']), plan(), 2);
    expect(ranked.map((alt) => alt.photo.key)).toEqual(['better', 'good']);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('includes photos the filters would skip when the filters are off', () => {
    const keys = rankAlternatives(photos, 'bestSmiles', new Set(), plan({ excludeBlurry: false })).map((alt) => alt.photo.key);
    expect(keys).toContain('blurry');
    expect(keys).not.toContain('scenery');
    expect(rankAlternatives(photos, 'noPeople', new Set(), plan()).map((alt) => alt.photo.key)).toEqual(['scenery']);
  });
});

describe('runSelection', () => {
  const photos = [
    photo('smile-a', metrics([face(0.95)]), 0, [0, 0, 0, 0]),
    photo('smile-a-again', metrics([face(0.94)]), 1, [0, 0, 0, 0]),
    photo('smile-b', metrics([face(0.6)]), 2, [1, 1, 1, 1]),
    photo('scene', metrics([]), 3, [-1, 1, -1, 1]),
  ];

  it('selects with the plan and skips near-duplicates when asked', () => {
    const loose = runSelection(photos, plan(), 0.5);
    expect(loose.isNearDuplicate).toBeUndefined();
    expect(loose.result.picks.map((p) => p.id)).toEqual(['smile-a', 'smile-a-again', 'scene']);

    const strict = runSelection(photos, plan({ avoidNearDuplicates: true }), 0.5);
    expect(strict.isNearDuplicate?.('smile-a', 'smile-a-again')).toBe(true);
    expect(strict.result.picks.map((p) => p.id)).toEqual(['smile-a', 'smile-b', 'scene']);
  });

  it('builds similarity items with a safe aspect ratio', () => {
    const items = similarityItems([{ ...photos[0], width: 0, height: 0 }, photos[1]]);
    expect(items.map((item) => [item.id, item.aspect, item.order])).toEqual([
      ['smile-a', 1, 0],
      ['smile-a-again', 4000 / 3000, 1],
    ]);
  });
});
