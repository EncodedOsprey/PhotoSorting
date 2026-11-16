import { describe, expect, it } from 'vitest';
import { SELECTION_CATEGORIES } from '../../core/types';
import {
  allocation,
  SETTINGS_STORAGE_KEY,
  assignmentSummary,
  defaultSettings,
  loadSettings,
  moveCategory,
  parseSettings,
  picksNothing,
  saveSettings,
  serializeSettings,
  toSelectionPlan,
  updateCategory,
} from './planSettings';

const stored = (settings: unknown) => JSON.stringify({ version: 1, settings });

describe('defaultSettings', () => {
  it('asks for 20 photos: 8 smiles, 4 group shots and 4 portraits, filled with best overall', () => {
    const settings = defaultSettings();
    expect(settings.totalCount).toBe(20);
    expect(settings.categories.filter((row) => row.enabled)).toEqual([
      { category: 'bestSmiles', enabled: true, count: 8 },
      { category: 'groupShots', enabled: true, count: 4 },
      { category: 'portraits', enabled: true, count: 4 },
    ]);
    expect(settings.categories.filter((row) => !row.enabled).every((row) => row.count === 4)).toBe(true);
    expect(settings.categories.map((row) => row.category).sort()).toEqual([...SELECTION_CATEGORIES].sort());
    expect(settings).toMatchObject({
      fillRemainder: true,
      avoidNearDuplicates: true,
      duplicateLooseness: 0.5,
      skipBlurry: true,
      skipClosedEyes: false,
    });
  });
});

describe('parseSettings', () => {
  it('round-trips serialized settings', () => {
    const settings = moveCategory(updateCategory(defaultSettings(), 'noPeople', { enabled: true, count: 6 }), 'noPeople', -1);
    settings.totalCount = 48;
    settings.duplicateLooseness = 0.8;
    settings.skipClosedEyes = true;
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
  });

  it.each([
    ['missing', null],
    ['not JSON', '{oops'],
    ['another version', JSON.stringify({ version: 0, settings: { totalCount: 5 } })],
    ['not an object', JSON.stringify([1, 2, 3])],
    ['settings not an object', stored('20')],
  ])('falls back to the defaults when data is %s', (_label, raw) => {
    expect(parseSettings(raw)).toEqual(defaultSettings());
  });

  it('repairs individual bad fields and keeps the good ones', () => {
    const settings = parseSettings(
      stored({
        totalCount: 5000,
        categories: [
          { category: 'portraits', enabled: true, count: 2.6 },
          { category: 'portraits', enabled: false, count: 9 },
          { category: 'selfies', enabled: true, count: 3 },
          { category: 'bestSmiles', enabled: 'yes', count: -4 },
          'groupShots',
        ],
        fillRemainder: 'no',
        avoidNearDuplicates: false,
        duplicateLooseness: 7,
        skipBlurry: null,
      }),
    );
    expect(settings.totalCount).toBe(999);
    expect(settings.categories.slice(0, 2)).toEqual([
      { category: 'portraits', enabled: true, count: 3 },
      { category: 'bestSmiles', enabled: false, count: 1 },
    ]);
    expect(settings.categories).toHaveLength(SELECTION_CATEGORIES.length);
    expect(new Set(settings.categories.map((row) => row.category)).size).toBe(SELECTION_CATEGORIES.length);
    expect(settings.categories.slice(2).every((row) => !row.enabled)).toBe(true);
    expect(settings).toMatchObject({
      fillRemainder: true,
      avoidNearDuplicates: false,
      duplicateLooseness: 1,
      skipBlurry: true,
      skipClosedEyes: false,
    });
  });

  it('uses the default categories when none are usable', () => {
    expect(parseSettings(stored({ totalCount: 10, categories: [{ category: 'nope' }] })).categories).toEqual(
      defaultSettings().categories,
    );
  });
});

describe('loadSettings / saveSettings', () => {
  it('persists under a versioned key and survives storage errors', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
    const settings = { ...defaultSettings(), totalCount: 7 };
    saveSettings(settings, storage);
    expect([...data.keys()]).toEqual([SETTINGS_STORAGE_KEY]);
    expect(loadSettings(storage)).toEqual(settings);

    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveSettings(settings, broken)).not.toThrow();
    expect(loadSettings(broken)).toEqual(defaultSettings());
  });
});

describe('toSelectionPlan', () => {
  it('sends enabled categories in priority order with the options', () => {
    let settings = updateCategory(defaultSettings(), 'noPeople', { enabled: true, count: 2 });
    settings = moveCategory(settings, 'portraits', -1);
    settings = { ...settings, fillRemainder: false, avoidNearDuplicates: false, skipBlurry: false, skipClosedEyes: true };
    expect(toSelectionPlan(settings)).toEqual({
      totalCount: 20,
      requests: [
        { category: 'bestSmiles', count: 8 },
        { category: 'portraits', count: 4 },
        { category: 'groupShots', count: 4 },
        { category: 'noPeople', count: 2 },
      ],
      fillRemainderWithBestOverall: false,
      avoidNearDuplicates: false,
      excludeBlurry: false,
      excludeClosedEyes: true,
    });
  });
});

describe('moveCategory', () => {
  it('swaps neighbours and ignores moves past either end', () => {
    const settings = defaultSettings();
    expect(moveCategory(settings, 'groupShots', -1).categories.slice(0, 2).map((row) => row.category)).toEqual([
      'groupShots',
      'bestSmiles',
    ]);
    expect(moveCategory(settings, 'bestSmiles', -1)).toBe(settings);
    expect(moveCategory(settings, 'bestOverall', 1)).toBe(settings);
  });
});

describe('assignmentSummary', () => {
  it('describes how the rest of the total is filled', () => {
    const settings = updateCategory(defaultSettings(), 'groupShots', { enabled: false });
    expect(assignmentSummary(settings).text).toBe('12 of 20 assigned · 8 filled with Best Overall');
    expect(assignmentSummary({ ...settings, fillRemainder: false }).text).toBe('12 of 20 assigned · 8 left unassigned');
    expect(assignmentSummary(defaultSettings())).toEqual({ assigned: 16, total: 20, remainder: 4, text: '16 of 20 assigned · 4 filled with Best Overall' });
    expect(assignmentSummary({ ...defaultSettings(), totalCount: 10 }).text).toBe('16 of 10 assigned');
  });
});

describe('picksNothing', () => {
  it('is true only when every category is off and filling is off', () => {
    const allOff = { ...defaultSettings(), categories: defaultSettings().categories.map((row) => ({ ...row, enabled: false })) };
    expect(picksNothing(allOff)).toBe(false);
    expect(picksNothing({ ...allOff, fillRemainder: false })).toBe(true);
    expect(picksNothing({ ...defaultSettings(), fillRemainder: false })).toBe(false);
  });
});

describe('allocation', () => {
  it('shares the total out in priority order, then fills or leaves the rest', () => {
    expect(allocation(defaultSettings())).toEqual({
      categories: [
        { category: 'bestSmiles', count: 8 },
        { category: 'groupShots', count: 4 },
        { category: 'portraits', count: 4 },
      ],
      fill: 4,
      unassigned: 0,
      over: 0,
    });
    expect(allocation({ ...defaultSettings(), fillRemainder: false })).toMatchObject({ fill: 0, unassigned: 4 });
  });

  it('caps later categories when the counts exceed the total', () => {
    expect(allocation({ ...defaultSettings(), totalCount: 10 })).toEqual({
      categories: [
        { category: 'bestSmiles', count: 8 },
        { category: 'groupShots', count: 2 },
      ],
      fill: 0,
      unassigned: 0,
      over: 6,
    });
  });
});
