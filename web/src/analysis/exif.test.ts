import { describe, expect, it } from 'vitest';
import { parseExifDateTime } from './exif';

describe('parseExifDateTime', () => {
  it('reads the exact instant when the EXIF offset is known', () => {
    expect(parseExifDateTime('2025:06:14 14:02:10', undefined, '-04:00')).toBe(Date.UTC(2025, 5, 14, 18, 2, 10));
    expect(parseExifDateTime('2025:06:14 14:02:10', '045', '+02:00')).toBe(Date.UTC(2025, 5, 14, 12, 2, 10, 45));
  });

  it('reads local camera time without an offset', () => {
    expect(parseExifDateTime('2025:06:14 14:02:10')).toBe(new Date(2025, 5, 14, 14, 2, 10).getTime());
    expect(parseExifDateTime('2025-06-14T14:02')).toBe(new Date(2025, 5, 14, 14, 2, 0).getTime());
    expect(parseExifDateTime('2025:06:14 14:02:10', '5', '+99:00')).toBe(new Date(2025, 5, 14, 14, 2, 10, 500).getTime());
  });

  it('accepts already parsed dates', () => {
    expect(parseExifDateTime(new Date(Date.UTC(2020, 0, 1)))).toBe(Date.UTC(2020, 0, 1));
    expect(parseExifDateTime(new Date(Number.NaN))).toBeNull();
  });

  it('returns null for missing, zeroed or malformed dates', () => {
    for (const value of [undefined, '', '0000:00:00 00:00:00', '    :  :     :  :  ', 'yesterday', '2025:13:01 10:00:00', 1718373730]) {
      expect(parseExifDateTime(value), String(value)).toBeNull();
    }
  });
});
