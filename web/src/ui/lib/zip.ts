// Builds a ZIP of the original photo files (a fallback when the share sheet can't be used).
import { Zip, ZipDeflate, ZipPassThrough, type ZipInputFile } from 'fflate';

/** Removes characters that aren't allowed in file names inside archives or on common file systems. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim().replace(/^\.+/, '');
  return cleaned || 'photo';
}

function splitExtension(name: string): [stem: string, extension: string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

/** Makes every name unique (case-insensitively, like the iOS and macOS file systems): "IMG_1.JPG", "IMG_1 (2).JPG"… */
export function uniqueFileNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((original) => {
    const name = sanitizeFileName(original);
    let candidate = name;
    if (used.has(candidate.toLowerCase())) {
      const [stem, extension] = splitExtension(name);
      let n = 2;
      do {
        candidate = `${stem} (${n})${extension}`;
        n += 1;
      } while (used.has(candidate.toLowerCase()));
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

const UNCOMPRESSED_TYPES = /^image\/(bmp|x-ms-bmp|tiff)$/i;
const UNCOMPRESSED_EXTENSIONS = /\.(bmp|tiff?)$/i;

/** JPEG, HEIC, PNG… are already compressed: store them as-is (fast, and the ZIP isn't smaller anyway). */
export function shouldDeflate(file: Pick<File, 'name' | 'type'>): boolean {
  return UNCOMPRESSED_TYPES.test(file.type) || UNCOMPRESSED_EXTENSIONS.test(file.name);
}

// ZIP timestamps only cover 1980–2099.
const ZIP_MIN_TIME = new Date(1980, 0, 2).getTime();
const ZIP_MAX_TIME = new Date(2099, 11, 30).getTime();

function zipTime(lastModified: number, fallback: number): Date {
  return new Date(lastModified >= ZIP_MIN_TIME && lastModified <= ZIP_MAX_TIME ? lastModified : fallback);
}

/**
 * The biggest ZIP file made in one go. A ZIP is built in memory, and iOS ends a page that uses too much memory (losing
 * the analysis and the picks) without any error to catch, so bigger selections are saved as several ZIP files.
 */
export const ZIP_PART_MAX_BYTES = 200 * 1024 * 1024;

// Per file: a local header (30 bytes), a data descriptor (16) and a central directory record (46), plus the name twice.
const ZIP_ENTRY_HEADER_BYTES = 30 + 16 + 46;
/** The end of central directory record that closes every ZIP file. */
export const ZIP_END_BYTES = 22;

const utf8 = new TextEncoder();

/**
 * How many bytes a file adds to a ZIP made by createZip when it's stored as-is, as photos are. (BMP and TIFF files are
 * compressed, so they add less.)
 */
export function zipEntryBytes(name: string, size: number): number {
  return size + ZIP_ENTRY_HEADER_BYTES + 2 * utf8.encode(name).length;
}

export interface ZipPart {
  /** Index of the first file (inclusive). */
  start: number;
  /** Index after the last file (exclusive). */
  end: number;
  /** Size of the part's ZIP file. */
  bytes: number;
}

/**
 * Splits files, given the bytes each adds to a ZIP (see zipEntryBytes), into consecutive parts whose ZIP files are at
 * most `maxBytes` each. Parts are filled in order, one after the other; a file too big for any part gets one of its own.
 */
export function zipParts(sizes: readonly number[], maxBytes: number = ZIP_PART_MAX_BYTES): ZipPart[] {
  const parts: ZipPart[] = [];
  sizes.forEach((size, index) => {
    const last = parts.at(-1);
    if (last && last.bytes + size <= maxBytes) {
      last.end = index + 1;
      last.bytes += size;
    } else {
      parts.push({ start: index, end: index + 1, bytes: ZIP_END_BYTES + size });
    }
  });
  return parts;
}

export interface ZipPlan {
  /** Unique names for all the files, so that the parts can be unzipped into one folder. */
  names: string[];
  parts: ZipPart[];
}

/** How a ZIP of these files is split into parts, decided from their sizes alone (nothing is read). */
export function planZip(files: readonly Pick<File, 'name' | 'size'>[], maxBytes: number = ZIP_PART_MAX_BYTES): ZipPlan {
  const names = uniqueFileNames(files.map((file) => file.name));
  return { names, parts: zipParts(files.map((file, index) => zipEntryBytes(names[index], file.size)), maxBytes) };
}

export interface ZipProgress {
  completed: number;
  total: number;
}

export interface CreateZipOptions {
  onProgress?: (progress: ZipProgress) => void;
  now?: number;
  /** Unique names for the files (by default, made from their own names). */
  names?: readonly string[];
  /** Stops before the next file is read; the promise then rejects with an AbortError. */
  signal?: AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The ZIP file was cancelled.', 'AbortError');
}

export async function createZip(files: readonly File[], options: CreateZipOptions = {}): Promise<Blob> {
  const now = options.now ?? Date.now();
  const names = options.names ?? uniqueFileNames(files.map((file) => file.name));
  const parts: Blob[] = [];
  let pending: Uint8Array<ArrayBuffer>[] = [];
  let failure: Error | null = null;
  let finished = false;

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error;
      return;
    }
    pending.push(chunk);
    if (final) finished = true;
  });
  // Move finished chunks into a Blob so each file's bytes are only held once.
  const flush = () => {
    if (pending.length === 0) return;
    parts.push(new Blob(pending));
    pending = [];
  };

  for (let index = 0; index < files.length; index++) {
    throwIfAborted(options.signal);
    const file = files[index];
    const data = new Uint8Array(await file.arrayBuffer());
    throwIfAborted(options.signal);
    const entry: ZipInputFile & { push(chunk: Uint8Array, final?: boolean): void } = shouldDeflate(file)
      ? new ZipDeflate(names[index], { level: 6 })
      : new ZipPassThrough(names[index]);
    entry.mtime = zipTime(file.lastModified, now);
    zip.add(entry);
    entry.push(data, true);
    if (failure) throw failure;
    flush();
    options.onProgress?.({ completed: index + 1, total: files.length });
  }
  zip.end();
  if (failure) throw failure;
  if (!finished) throw new Error('The ZIP file couldn’t be finished.');
  flush();
  return new Blob(parts, { type: 'application/zip' });
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "PhotoSorting Picks 2025-06-14.zip", or "PhotoSorting Picks 2025-06-14 (1 of 3).zip" for one of several parts. */
export function zipFileName(date: Date = new Date(), part?: { index: number; count: number }): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return part && part.count > 1 ? `PhotoSorting Picks ${day} (${part.index + 1} of ${part.count}).zip` : `PhotoSorting Picks ${day}.zip`;
}

/** Saves a Blob through a temporary <a download> link (Safari shows its download prompt). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Safari reads the URL asynchronously after the click; revoking right away can cancel the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
