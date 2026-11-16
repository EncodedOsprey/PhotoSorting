import { describe, expect, it } from 'vitest';
import { defaultSettings, updateCategory } from '../state/planSettings';
import { findStatus } from './findStatus';

describe('findStatus', () => {
  it('explains why the button is disabled', () => {
    expect(findStatus(0, 0, defaultSettings())).toEqual({ blocked: true, note: 'Choose photos to get started.' });
    expect(findStatus(5, 0, { ...defaultSettings(), totalCount: 10 })).toEqual({
      blocked: true,
      note: 'Category counts add up to 16, which is more than the total of 10.',
    });
    const nothing = { ...defaultSettings(), fillRemainder: false };
    const allOff = ['bestSmiles', 'groupShots', 'portraits'].reduce(
      (settings, category) => updateCategory(settings, category as 'bestSmiles', { enabled: false }),
      nothing,
    );
    expect(findStatus(5, 0, allOff).blocked).toBe(true);
  });

  it('says how much is left to analyze', () => {
    expect(findStatus(248, 0, defaultSettings())).toEqual({ blocked: false, note: '248 photos to analyze on this iPhone' });
    expect(findStatus(248, 37, defaultSettings()).note).toBe('211 new photos to analyze · 37 done');
    expect(findStatus(248, 248, defaultSettings()).note).toBe('Already analyzed — results are instant.');
  });
});
