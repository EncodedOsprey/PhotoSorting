// Capture time from EXIF (DateTimeOriginal, falling back to CreateDate).
// Files from the iOS photo picker keep their EXIF; File.lastModified is the export time, not the capture time.
import exifr from 'exifr';

const TAGS = [
  'DateTimeOriginal',
  'OffsetTimeOriginal',
  'SubSecTimeOriginal',
  'CreateDate',
  'OffsetTimeDigitized',
  'SubSecTimeDigitized',
] as const;

type ExifValue = string | number | Date | undefined;
type ExifTags = Partial<Record<(typeof TAGS)[number], ExifValue>>;

/** Capture time in ms since epoch, or null when the file has no (valid) EXIF date. Never throws. */
export async function readCaptureTime(file: Blob): Promise<number | null> {
  try {
    // `pick` makes exifr read only the blocks holding these tags (reading just the start of the file).
    const tags = (await exifr.parse(file, {
      pick: [...TAGS],
      reviveValues: false,
      translateValues: false,
    })) as ExifTags | undefined;
    if (!tags) return null;
    return (
      parseExifDateTime(tags.DateTimeOriginal, tags.SubSecTimeOriginal, tags.OffsetTimeOriginal) ??
      parseExifDateTime(tags.CreateDate, tags.SubSecTimeDigitized, tags.OffsetTimeDigitized)
    );
  } catch {
    return null;
  }
}

const DATE_TIME = /^\s*(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;
const OFFSET = /^\s*([+-])(\d{2}):?(\d{2})\s*$/;

/**
 * Parses an EXIF date ("YYYY:MM:DD HH:MM:SS") into ms since epoch. With an EXIF offset ("+02:00") the result is
 * the exact instant; without one the camera's local time is read in the browser's time zone (only differences
 * between photos of the same shoot matter). SubSec ("123" = 0.123 s) adds sub-second precision.
 * Returns null for missing, malformed or zeroed ("0000:00:00 00:00:00") dates.
 */
export function parseExifDateTime(value: ExifValue, subSec?: ExifValue, offset?: ExifValue): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== 'string') return null;
  const match = DATE_TIME.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second = 0] = match.slice(1).map((part) => Number(part ?? 0));
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
    return null;
  }

  const offsetMinutes = parseOffsetMinutes(offset);
  const time =
    offsetMinutes === null
      ? new Date(year, month - 1, day, hour, minute, second).getTime()
      : Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
  if (!Number.isFinite(time)) return null;
  return time + subSecondMs(subSec);
}

function parseOffsetMinutes(offset: ExifValue): number | null {
  if (typeof offset !== 'string') return null;
  const match = OFFSET.exec(offset);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  if (minutes > 14 * 60) return null;
  return match[1] === '-' ? -minutes : minutes;
}

function subSecondMs(subSec: ExifValue): number {
  if (subSec === undefined || subSec instanceof Date) return 0;
  const digits = String(subSec).trim();
  if (!/^\d{1,9}$/.test(digits)) return 0;
  return Math.round(Number(`0.${digits}`) * 1000);
}
