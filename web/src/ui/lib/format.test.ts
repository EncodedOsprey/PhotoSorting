import { describe, expect, it } from 'vitest';
import { estimateRemainingSeconds, formatBytes, formatCaptureTime, percent, photoRange, plural, remainingText, scoreValue } from './format';

describe('format', () => {
  it('pluralises and formats scores', () => {
    expect(plural(1, 'photo')).toBe('1 photo');
    expect(plural(3, 'photo')).toBe('3 photos');
    expect(percent(0.456)).toBe('46%');
    expect(percent(Number.NaN)).toBe('0%');
    expect(scoreValue(1.2)).toBe(100);
  });

  it('estimates time left only after a few photos', () => {
    expect(estimateRemainingSeconds(2, 100, 10_000)).toBeNull();
    expect(estimateRemainingSeconds(10, 100, 1000)).toBeNull();
    expect(estimateRemainingSeconds(10, 10, 10_000)).toBeNull();
    expect(estimateRemainingSeconds(10, 100, 10_000)).toBe(90);
  });

  it('describes time left in words', () => {
    expect(remainingText(null)).toBeNull();
    expect(remainingText(20)).toBe('Less than a minute left');
    expect(remainingText(65)).toBe('About 1 minute left');
    expect(remainingText(150)).toBe('About 3 minutes left');
    expect(remainingText(3600)).toBe('About 1 hour left');
    expect(remainingText(5400)).toBe('About 1 h 30 min left');
  });

  it('formats capture times when known', () => {
    expect(formatCaptureTime(null)).toBeNull();
    expect(formatCaptureTime(Date.UTC(2025, 5, 14, 12))).toMatch(/2025/);
  });
});

describe('photoRange', () => {
  it('names one photo or a range of them', () => {
    expect(photoRange(0, 4)).toBe('Photos 1–4');
    expect(photoRange(4, 5)).toBe('Photo 5');
  });
});

describe('formatBytes', () => {
  it('uses units of 1000 like iOS, with a decimal only below 10', () => {
    expect(formatBytes(400)).toBe('400 bytes');
    expect(formatBytes(850_000)).toBe('850 KB');
    expect(formatBytes(4_200_000)).toBe('4.2 MB');
    expect(formatBytes(4_000_000)).toBe('4 MB');
    expect(formatBytes(999_600)).toBe('1 MB');
    expect(formatBytes(4 * 45 * 1024 * 1024)).toBe('189 MB');
    expect(formatBytes(1_240_000_000)).toBe('1.2 GB');
  });
});
