// Saving picks through the iOS share sheet (Web Share API Level 2).

/** iOS gets unreliable when sharing many files at once, so larger selections are shared in batches. */
export const SHARE_BATCH_SIZE = 40;

export interface ShareBatch {
  /** Index of the first photo (inclusive). */
  start: number;
  /** Index after the last photo (exclusive). */
  end: number;
  /** "Share 1–40" */
  label: string;
}

export function shareBatches(count: number, size = SHARE_BATCH_SIZE): ShareBatch[] {
  const batches: ShareBatch[] = [];
  const step = Math.max(1, Math.floor(size));
  for (let start = 0; start < count; start += step) {
    const end = Math.min(count, start + step);
    batches.push({ start, end, label: `Share ${start + 1}–${end}` });
  }
  return batches;
}

type ShareCapableNavigator = Partial<Pick<Navigator, 'share' | 'canShare'>>;

const currentNavigator = (): ShareCapableNavigator | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator;

export function canShareFiles(files: readonly File[], nav: ShareCapableNavigator | undefined = currentNavigator()): boolean {
  if (!nav || files.length === 0 || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [...files] });
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet with the original files. Call it synchronously from a click handler: any await before it
 * uses up the tap's user activation and the browser refuses to share.
 */
export function shareFiles(files: readonly File[], nav: ShareCapableNavigator | undefined = currentNavigator()): Promise<void> {
  if (!nav?.share) return Promise.reject(new Error('Sharing isn’t available in this browser.'));
  return nav.share({ files: [...files] });
}

/** The photographer closed the share sheet without choosing anything. */
export function isShareCancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/** Explains how to get shared files into the Photos library. */
export function saveHint(count: number): string {
  const action = count === 1 ? 'Save Image' : `Save ${count} Images`;
  return `In the share sheet, choose “${action}” to add them to Photos (they’re added as copies).`;
}
