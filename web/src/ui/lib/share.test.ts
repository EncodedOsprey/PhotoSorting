import { describe, expect, it, vi } from 'vitest';
import { canShareFiles, isShareCancelled, saveHint, shareBatches, shareFiles } from './share';

const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' })];

describe('shareBatches', () => {
  it('splits into batches of 40 with human-friendly labels', () => {
    expect(shareBatches(0)).toEqual([]);
    expect(shareBatches(40).map((b) => b.label)).toEqual(['Share 1–40']);
    expect(shareBatches(95)).toEqual([
      { start: 0, end: 40, label: 'Share 1–40' },
      { start: 40, end: 80, label: 'Share 41–80' },
      { start: 80, end: 95, label: 'Share 81–95' },
    ]);
  });
});

describe('canShareFiles', () => {
  it('needs both share and a canShare that accepts the files', () => {
    expect(canShareFiles(files, undefined)).toBe(false);
    expect(canShareFiles(files, { share: vi.fn() })).toBe(false);
    expect(canShareFiles([], { share: vi.fn(), canShare: () => true })).toBe(false);
    expect(canShareFiles(files, { share: vi.fn(), canShare: () => false })).toBe(false);
    expect(
      canShareFiles(files, {
        share: vi.fn(),
        canShare: () => {
          throw new TypeError('bad');
        },
      }),
    ).toBe(false);
    expect(canShareFiles(files, { share: vi.fn(), canShare: (data) => data?.files?.length === 1 })).toBe(true);
  });
});

describe('shareFiles', () => {
  it('shares only the files, synchronously', () => {
    const share = vi.fn(() => Promise.resolve());
    void shareFiles(files, { share });
    expect(share).toHaveBeenCalledWith({ files });
  });

  it('rejects when sharing is unavailable', async () => {
    await expect(shareFiles(files, {})).rejects.toThrow(/isn’t available/);
  });
});

describe('isShareCancelled', () => {
  it('recognises AbortError only', () => {
    expect(isShareCancelled(new DOMException('cancelled', 'AbortError'))).toBe(true);
    expect(isShareCancelled(new DOMException('nope', 'NotAllowedError'))).toBe(false);
    expect(isShareCancelled(undefined)).toBe(false);
  });
});

describe('saveHint', () => {
  it('names the share sheet action', () => {
    expect(saveHint(20)).toContain('“Save 20 Images”');
    expect(saveHint(1)).toContain('“Save Image”');
  });
});
