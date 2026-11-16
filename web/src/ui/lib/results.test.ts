import { describe, expect, it } from 'vitest';
import type { PhotoPick, SelectionPlan } from '../../core/types';
import { buildSections, keptIds, keptInSection, setKept, shortfall, swapPick, type ResultSection } from './results';

const note = (section: ResultSection) => shortfall(section)?.text ?? null;

const plan = (overrides: Partial<SelectionPlan> = {}): SelectionPlan => ({
  totalCount: 10,
  requests: [
    { category: 'bestSmiles', count: 3 },
    { category: 'groupShots', count: 4 },
  ],
  fillRemainderWithBestOverall: true,
  avoidNearDuplicates: false,
  excludeBlurry: false,
  excludeClosedEyes: false,
  ...overrides,
});

const pick = (id: string, category: PhotoPick<string>['category'], score = 0.5): PhotoPick<string> => ({ id, category, score });

describe('buildSections', () => {
  it('groups picks by request in plan order, then the remainder as More Great Shots', () => {
    const picks = [
      pick('s1', 'bestSmiles'),
      pick('s2', 'bestSmiles'),
      pick('s3', 'bestSmiles'),
      pick('g1', 'groupShots'),
      pick('g2', 'groupShots'),
      pick('o1', 'bestOverall'),
      pick('o2', 'bestOverall'),
    ];
    const sections = buildSections(plan(), picks);
    expect(sections.map((s) => [s.key, s.title, s.slots.map((slot) => picks[slot].id), s.requested])).toEqual([
      ['bestSmiles', 'Best Smiles', ['s1', 's2', 's3'], 3],
      ['groupShots', 'Group Shots', ['g1', 'g2'], 4],
      ['fill', 'More Great Shots', ['o1', 'o2'], 5],
    ]);
    expect(sections.map(note)).toEqual([
      null,
      'Only 2 of 4 — not enough photos with 3+ people',
      'Only 2 of 5 — not enough photos left',
    ]);
  });

  it('caps requests at what is left of the total and skips requests after the total is used up', () => {
    const sections = buildSections(
      plan({
        totalCount: 4,
        requests: [
          { category: 'bestSmiles', count: 3 },
          { category: 'portraits', count: 3 },
          { category: 'noPeople', count: 2 },
        ],
      }),
      [pick('a', 'bestSmiles'), pick('b', 'bestSmiles'), pick('c', 'bestSmiles'), pick('d', 'portraits')],
    );
    expect(sections.map((s) => [s.key, s.slots.length, s.requested])).toEqual([
      ['bestSmiles', 3, 3],
      ['portraits', 1, 1],
    ]);
  });

  it('keeps empty requested sections (to explain them) and separates a Best Overall request from the fill', () => {
    const picks = [pick('o1', 'bestOverall'), pick('o2', 'bestOverall'), pick('o3', 'bestOverall')];
    const sections = buildSections(
      plan({
        totalCount: 3,
        requests: [
          { category: 'noPeople', count: 1 },
          { category: 'bestOverall', count: 1 },
        ],
      }),
      picks,
    );
    expect(sections.map((s) => [s.key, s.slots, s.requested])).toEqual([
      ['noPeople', [], 1],
      ['bestOverall', [0], 1],
      ['fill', [1, 2], 2],
    ]);
    expect(note(sections[0])).toBe('None found — not enough photos without people');
  });

  it('has no fill section when filling is off and every pick is accounted for', () => {
    const sections = buildSections(plan({ fillRemainderWithBestOverall: false }), [pick('s1', 'bestSmiles')]);
    expect(sections.map((s) => s.key)).toEqual(['bestSmiles', 'groupShots']);
    expect(note(sections[0])).toBe('Only 1 of 3 — not enough photos with faces');
    expect(note(sections[1])).toBe('None found — not enough photos with 3+ people');
  });
});

describe('shortfall', () => {
  const picks = [pick('g1', 'bestSmiles'), pick('g2', 'eyesOpen'), pick('g3', 'groupShots')];
  const sections = buildSections(
    plan({
      totalCount: 4,
      requests: [
        { category: 'bestSmiles', count: 1 },
        { category: 'eyesOpen', count: 1 },
        { category: 'groupShots', count: 2 },
      ],
      fillRemainderWithBestOverall: false,
    }),
    picks,
  );
  const groupShots = sections[2];

  it('says which earlier categories took the matching photos', () => {
    expect(shortfall(groupShots, { sections, picks, eligible: new Set(['g1', 'g2', 'g3']) })).toEqual({
      text: 'Only 1 of 2 — other photos with 3+ people were picked for Best Smiles and Eyes Open first',
      reason: 'pickedEarlier',
    });
    const empty = { ...groupShots, slots: [] };
    expect(shortfall(empty, { sections: [sections[0], empty], picks, eligible: new Set(['g1']) })?.text).toBe(
      'None left — photos with 3+ people were picked for Best Smiles first',
    );
  });

  it('says when the other matching photos are near-duplicates of picks, and otherwise that there are not enough', () => {
    expect(shortfall(groupShots, { sections, picks, eligible: new Set(['g3', 'g4']) })).toEqual({
      text: 'Only 1 of 2 — other photos with 3+ people are near-duplicates of other picks',
      reason: 'nearDuplicates',
    });
    expect(shortfall(groupShots, { sections, picks, eligible: new Set(['g3']) })).toEqual({
      text: 'Only 1 of 2 — not enough photos with 3+ people',
      reason: 'notEnough',
    });
  });
});

describe('editing picks', () => {
  const picks = [pick('a', 'bestSmiles', 0.9), pick('b', 'bestSmiles', 0.8), pick('c', 'bestOverall', 0.7)];

  it('counts only kept photos', () => {
    const removed = setKept(new Set<string>(), 'b', false);
    expect(keptIds(picks, removed)).toEqual(['a', 'c']);
    const [smiles] = buildSections(plan(), picks);
    expect(keptInSection(smiles, picks, removed)).toBe(1);
    expect(setKept(removed, 'b', true).size).toBe(0);
  });

  it('swaps a pick in place, keeping its category, and keeps the new photo', () => {
    const swapped = swapPick(picks, new Set(['b']), 1, { id: 'z', score: 0.6 });
    expect(swapped.picks.map((p) => [p.id, p.category, p.score])).toEqual([
      ['a', 'bestSmiles', 0.9],
      ['z', 'bestSmiles', 0.6],
      ['c', 'bestOverall', 0.7],
    ]);
    expect(swapped.removed.size).toBe(0);
    expect(picks[1].id).toBe('b');
  });
});
