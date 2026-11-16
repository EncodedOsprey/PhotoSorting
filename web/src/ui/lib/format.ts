// Small text formatting helpers.

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "Photos 1–4", or "Photo 5" for one photo, from 0-based indexes (end exclusive). */
export function photoRange(start: number, end: number): string {
  return end - start === 1 ? `Photo ${end}` : `Photos ${start + 1}–${end}`;
}

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'];

/** File sizes the way iOS shows them, in units of 1000: "850 KB", "4.2 MB", "189 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (!(bytes >= 1000)) return plural(Math.max(0, Math.round(bytes) || 0), 'byte');
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 999.5 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 9.95 ? Number(value.toFixed(1)) : Math.round(value)} ${BYTE_UNITS[unit]}`;
}

/** 0…1 → "0%"…"100%". */
export function percent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

/** 0…1 → 0…100, as shown on score badges. */
export function scoreValue(value: number): number {
  return Math.round(clamp01(value) * 100);
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Seconds left, extrapolated from the average time per photo so far.
 * Null until a few photos are done, because the first ones include warm-up time.
 */
export function estimateRemainingSeconds(completed: number, total: number, elapsedMs: number): number | null {
  if (completed < 3 || elapsedMs < 2000 || total <= completed) return null;
  return ((elapsedMs / completed) * (total - completed)) / 1000;
}

export function remainingText(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 50) return 'Less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${plural(Math.max(1, minutes), 'minute')} left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `About ${plural(hours, 'hour')} left` : `About ${hours} h ${rest} min left`;
}

const captureFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "Jun 14, 2025 at 4:32 PM" — null when the photo has no capture time. */
export function formatCaptureTime(capturedAt: number | null | undefined): string | null {
  if (capturedAt === null || capturedAt === undefined || !Number.isFinite(capturedAt)) return null;
  return captureFormat.format(new Date(capturedAt));
}
