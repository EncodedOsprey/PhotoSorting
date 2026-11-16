// File identity and type helpers shared by the analyzer and the UI.
import type { AnalyzedPhoto } from './types';

/** Image formats the browser decodes itself. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'avif', 'tif', 'tiff']);

/** Camera RAW formats, decoded from the JPEG preview they embed (see rawPreview.ts). */
const RAW_EXTENSIONS: ReadonlySet<string> = new Set([
  'nef', 'nrw', 'cr2', 'cr3', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'srw',
]);

/** Stable identity of a picked file: `${name}|${size}|${lastModified}`. */
export function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** Lower-case extension without the dot, or '' when the name has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** True when the MIME type is image/* or, if the browser left it empty, the extension is a known image or RAW type. */
export function isProbablyImage(file: File): boolean {
  if (file.type.toLowerCase().startsWith('image/')) return true;
  const extension = fileExtension(file.name);
  return IMAGE_EXTENSIONS.has(extension) || RAW_EXTENSIONS.has(extension);
}

/** Frees the photo's thumbnail object URL. Safe to call more than once. */
export function releaseAnalyzedPhoto(photo: AnalyzedPhoto): void {
  if (photo.thumbnailUrl) URL.revokeObjectURL(photo.thumbnailUrl);
}
