// File identity and type helpers shared by the analyzer and the UI.
import type { AnalyzedPhoto } from './types';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'avif', 'tif', 'tiff']);

/** Stable identity of a picked file: `${name}|${size}|${lastModified}`. */
export function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** True when the MIME type is image/* or, if the browser left it empty, the extension is a known image type. */
export function isProbablyImage(file: File): boolean {
  if (file.type.toLowerCase().startsWith('image/')) return true;
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase());
}

/** Frees the photo's thumbnail object URL. Safe to call more than once. */
export function releaseAnalyzedPhoto(photo: AnalyzedPhoto): void {
  if (photo.thumbnailUrl) URL.revokeObjectURL(photo.thumbnailUrl);
}
