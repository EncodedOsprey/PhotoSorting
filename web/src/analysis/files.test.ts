import { describe, expect, it } from 'vitest';
import { fileKey, isProbablyImage } from './files';

describe('fileKey', () => {
  it('combines name, size and modification time', () => {
    const file = new File(['abc'], 'IMG_0001.JPG', { type: 'image/jpeg', lastModified: 1_700_000_000_000 });
    expect(fileKey(file)).toBe('IMG_0001.JPG|3|1700000000000');
  });
});

describe('isProbablyImage', () => {
  const file = (name: string, type = '') => new File([], name, { type });

  it('accepts image MIME types and known image extensions', () => {
    expect(isProbablyImage(file('upload', 'image/heic'))).toBe(true);
    expect(isProbablyImage(file('IMG_0001.HEIC'))).toBe(true);
    for (const extension of ['jpg', 'jpeg', 'png', 'heif', 'webp', 'gif', 'avif', 'tif', 'tiff']) {
      expect(isProbablyImage(file(`photo.${extension}`)), extension).toBe(true);
    }
  });

  it('accepts camera RAW files the browser gave no MIME type', () => {
    for (const name of ['DSC_0001.NEF', 'IMG_0001.CR3', 'DSC00001.ARW', 'IMG_0001.dng', 'DSCF0001.RAF']) {
      expect(isProbablyImage(file(name)), name).toBe(true);
    }
  });

  it('rejects other files', () => {
    expect(isProbablyImage(file('clip.mov', 'video/quicktime'))).toBe(false);
    expect(isProbablyImage(file('notes.txt', 'text/plain'))).toBe(false);
    expect(isProbablyImage(file('photo.jpg.zip'))).toBe(false);
    expect(isProbablyImage(file('README'))).toBe(false);
  });
});
