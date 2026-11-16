import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  ZIP_END_BYTES,
  ZIP_PART_MAX_BYTES,
  createZip,
  planZip,
  sanitizeFileName,
  shouldDeflate,
  uniqueFileNames,
  zipFileName,
  zipParts,
} from './zip';

describe('uniqueFileNames', () => {
  it('numbers repeats case-insensitively, before the extension', () => {
    expect(uniqueFileNames(['IMG_1.JPG', 'img_1.jpg', 'IMG_1.JPG', 'IMG_1 (2).JPG', 'README'])).toEqual([
      'IMG_1.JPG',
      'img_1 (2).jpg',
      'IMG_1 (3).JPG',
      'IMG_1 (2) (2).JPG',
      'README',
    ]);
  });
});

describe('sanitizeFileName', () => {
  it('drops folders and characters file systems reject', () => {
    expect(sanitizeFileName('a/b\\c:d?.jpg')).toBe('c_d_.jpg');
    expect(sanitizeFileName('..hidden.jpg')).toBe('hidden.jpg');
    expect(sanitizeFileName('  ')).toBe('photo');
  });
});

describe('shouldDeflate', () => {
  it('stores already-compressed photos', () => {
    expect(shouldDeflate({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false);
    expect(shouldDeflate({ name: 'a.heic', type: 'image/heic' })).toBe(false);
    expect(shouldDeflate({ name: 'scan.TIF', type: '' })).toBe(true);
  });
});

describe('createZip', () => {
  it('stores the original bytes under unique names', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const files = [
      new File([jpeg], 'IMG_1.jpg', { type: 'image/jpeg', lastModified: Date.UTC(2024, 5, 14, 12) }),
      new File([new Uint8Array([4, 5, 6])], 'IMG_1.jpg', { type: 'image/jpeg', lastModified: 0 }),
      new File([new Uint8Array(1000)], 'scan.bmp', { type: 'image/bmp' }),
    ];
    const progress: number[] = [];
    const blob = await createZip(files, { onProgress: ({ completed }) => progress.push(completed) });
    expect(blob.type).toBe('application/zip');
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(['IMG_1.jpg', 'IMG_1 (2).jpg', 'scan.bmp']);
    expect([...entries['IMG_1.jpg']]).toEqual([...jpeg]);
    expect([...entries['IMG_1 (2).jpg']]).toEqual([4, 5, 6]);
    expect(entries['scan.bmp']).toHaveLength(1000);
    expect(progress).toEqual([1, 2, 3]);
    // Stored, not deflated: the archive is bigger than the JPEG bytes together.
    expect(blob.size).toBeGreaterThan(jpeg.length + 3);
  });
});

describe('createZip options', () => {
  const files = [new File([new Uint8Array([1, 2])], 'a.jpg'), new File([new Uint8Array([3])], 'b.jpg')];

  it('uses the names it is given', async () => {
    const blob = await createZip(files, { names: ['IMG_1 (2).jpg', 'IMG_1 (3).jpg'] });
    expect(Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())))).toEqual(['IMG_1 (2).jpg', 'IMG_1 (3).jpg']);
  });

  it('stops before reading the next file once cancelled', async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const zipping = createZip(files, {
      signal: controller.signal,
      onProgress: ({ completed }) => {
        progress.push(completed);
        controller.abort();
      },
    });
    await expect(zipping).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).toEqual([1]);
  });
});

describe('zipParts', () => {
  // Part sizes include the end record every ZIP file has.
  const END = ZIP_END_BYTES;

  it('has no parts for no files', () => {
    expect(zipParts([], 100)).toEqual([]);
  });

  it('fills a part up to exactly the cap, and starts a new one a byte later', () => {
    expect(zipParts([60, 40], END + 100)).toEqual([{ start: 0, end: 2, bytes: END + 100 }]);
    expect(zipParts([60, 40], END + 99)).toEqual([
      { start: 0, end: 1, bytes: END + 60 },
      { start: 1, end: 2, bytes: END + 40 },
    ]);
  });

  it('fills the parts in order without moving photos around', () => {
    expect(zipParts([70, 50, 30, 20], END + 100)).toEqual([
      { start: 0, end: 1, bytes: END + 70 },
      { start: 1, end: 4, bytes: END + 100 },
    ]);
  });

  it('gives a file bigger than the cap a part of its own', () => {
    expect(zipParts([300, 50, 500, 20, 30], END + 100)).toEqual([
      { start: 0, end: 1, bytes: END + 300 },
      { start: 1, end: 2, bytes: END + 50 },
      { start: 2, end: 3, bytes: END + 500 },
      { start: 3, end: 5, bytes: END + 50 },
    ]);
  });
});

describe('planZip', () => {
  it('splits big selections into ZIP files of at most ZIP_PART_MAX_BYTES', () => {
    const photos = Array.from({ length: 6 }, (_, index) => ({ name: `IMG_${index}.JPG`, size: 45 * 1024 * 1024 }));
    const { parts } = planZip(photos);
    expect(parts.map(({ start, end }) => [start, end])).toEqual([
      [0, 4],
      [4, 6],
    ]);
    expect(parts.every((part) => part.bytes <= ZIP_PART_MAX_BYTES)).toBe(true);
    expect(planZip(photos.slice(0, 4)).parts).toHaveLength(1);
  });

  it('names files uniquely across all parts and knows the exact size of each ZIP file', async () => {
    const files = [
      new File([new Uint8Array(500)], 'Café.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(300)], 'café.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(200)], 'IMG_2.HEIC', { type: 'image/heic' }),
    ];
    const plan = planZip(files, 1200);
    expect(plan.names).toEqual(['Café.jpg', 'café (2).jpg', 'IMG_2.HEIC']);
    expect(plan.parts.map(({ start, end }) => [start, end])).toEqual([
      [0, 2],
      [2, 3],
    ]);
    for (const part of plan.parts) {
      const blob = await createZip(files.slice(part.start, part.end), { names: plan.names.slice(part.start, part.end) });
      expect(blob.size).toBe(part.bytes);
    }
  });
});

describe('zipFileName', () => {
  it('includes the local date', () => {
    expect(zipFileName(new Date(2025, 5, 4))).toBe('PhotoSorting Picks 2025-06-04.zip');
  });

  it('numbers the parts of a ZIP that comes in several files', () => {
    expect(zipFileName(new Date(2025, 5, 14), { index: 0, count: 3 })).toBe('PhotoSorting Picks 2025-06-14 (1 of 3).zip');
    expect(zipFileName(new Date(2025, 5, 14), { index: 2, count: 3 })).toBe('PhotoSorting Picks 2025-06-14 (3 of 3).zip');
    expect(zipFileName(new Date(2025, 5, 14), { index: 0, count: 1 })).toBe('PhotoSorting Picks 2025-06-14.zip');
  });
});
