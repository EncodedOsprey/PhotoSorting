// Full-size JPEG previews embedded in camera RAW files.
//
// Browsers can't develop RAW files. Given a NEF, ARW, DNG… Safari decodes only the small TIFF thumbnail at the start of
// the file (160×120 on Nikon), so photos looked blurry and faces were missed; Chrome decodes nothing. Cameras also embed
// a JPEG preview — full-size on most Nikon, Canon, Sony, Pentax and Samsung bodies, about 1600–1900 px on older Sony,
// Fujifilm and Panasonic ones — and, like photo-culling apps, we decode the largest one instead of the RAW data.
import { fileExtension, IMAGE_EXTENSIONS } from './files';

export interface RawPreview {
  /** JPEG with the RAW file's orientation, to decode in place of the file. It references the file's bytes (no copy). */
  readonly blob: Blob;
  /** Stored pixel size, before orientation. */
  readonly width: number;
  readonly height: number;
}

/**
 * Finds the largest JPEG preview embedded in a camera RAW file: NEF/NRW, CR2, CR3, ARW/SRF/SR2, DNG, PEF, SRW, ORF,
 * RW2/RWL or RAF. Reads only the file's metadata (a few small blocks). Returns null for other files (those with a
 * browser-decodable image extension aren't read at all), for RAW files without a usable preview, and on read errors.
 */
export async function findRawPreview(file: Blob): Promise<RawPreview | null> {
  if (file instanceof File && IMAGE_EXTENSIONS.has(fileExtension(file.name))) return null;
  try {
    const found = await findPreview(new ByteSource(file));
    if (!found) return null;
    const { jpeg, orientation } = found;
    return { blob: previewBlob(file, jpeg, orientation), width: jpeg.width, height: jpeg.height };
  } catch {
    return null;
  }
}

/** A JPEG stream in the file, as recorded by the RAW container. */
interface Candidate {
  offset: number;
  length: number;
}

/** A candidate that is a JPEG the browser can decode. */
interface Jpeg extends Candidate {
  width: number;
  height: number;
  /** [start, end) of its EXIF (APP1) segments. */
  exif: Array<[number, number]>;
}

interface Scan {
  candidates: Candidate[];
  /** EXIF orientation (1–8) of the RAW file, or null when it doesn't record one. */
  orientation: number | null;
}

async function findPreview(source: ByteSource): Promise<{ jpeg: Jpeg; orientation: number | null } | null> {
  const head = await source.bytes(0, 96);
  let scan: Scan;
  if (ascii(head, 0, 16) === 'FUJIFILMCCD-RAW ') {
    // RAF: the header points at the JPEG, which carries its own EXIF orientation.
    if (head.length < 92) return null;
    scan = { candidates: [{ offset: u32(head, 84, false), length: u32(head, 88, false) }], orientation: null };
  } else if (ascii(head, 4, 8) === 'ftypcrx ') {
    scan = await scanCr3(source);
  } else {
    const header = tiffHeader(head, 0);
    if (!header) return null;
    scan = await scanTiff(source, header);
  }

  let best: Jpeg | null = null;
  const seen = new Set<number>();
  for (const { offset, length } of scan.candidates) {
    if (seen.has(offset)) continue;
    seen.add(offset);
    const jpeg = await inspectJpeg(source, offset, length);
    if (jpeg && (!best || jpeg.width * jpeg.height > best.width * best.height)) best = jpeg;
  }
  return best && { jpeg: best, orientation: scan.orientation };
}

/**
 * The preview as a JPEG blob. The previews of most cameras have no EXIF (the RAW container holds the metadata), so
 * the file's orientation is written into a fresh EXIF segment that replaces any the preview has.
 */
function previewBlob(file: Blob, jpeg: Jpeg, orientation: number | null): Blob {
  const end = jpeg.offset + jpeg.length;
  if (orientation === null || (orientation === 1 && jpeg.exif.length === 0)) return file.slice(jpeg.offset, end, 'image/jpeg');
  const parts: BlobPart[] = [orientationHeader(orientation)];
  let at = jpeg.offset + 2;
  for (const [start, stop] of jpeg.exif) {
    parts.push(file.slice(at, start));
    at = stop;
  }
  parts.push(file.slice(at, end));
  return new Blob(parts, { type: 'image/jpeg' });
}

/** SOI followed by a minimal EXIF segment holding only the orientation. */
function orientationHeader(orientation: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.of(
    0xff, 0xd8, // SOI
    0xff, 0xe1, 0x00, 0x22, // APP1, 34 bytes
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header, IFD0 at 8
    0x00, 0x01, // one entry: Orientation, SHORT, count 1
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // no next IFD
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// TIFF-based RAW files (NEF, CR2, ARW, DNG, PEF, SRW, ORF, RW2…)

const TIFF_MAGIC = 42;
const ORF_MAGICS = new Set([0x4f52, 0x5352]); // Olympus "RO", "RS"
const RW2_MAGIC = 0x55; // Panasonic, Leica

const SHORT = 3;
const LONG = 4;
const UNDEFINED = 7;
const IFD = 13;

const TAG_COMPRESSION = 0x0103;
const TAG_STRIP_OFFSETS = 0x0111;
const TAG_ORIENTATION = 0x0112;
const TAG_STRIP_BYTE_COUNTS = 0x0117;
const TAG_SUB_IFDS = 0x014a;
const TAG_JPEG_OFFSET = 0x0201;
const TAG_JPEG_LENGTH = 0x0202;
const TAG_EXIF_IFD = 0x8769;
const TAG_MAKER_NOTE = 0x927c;
const TAG_RW2_JPEG = 0x002e;
const TAG_NIKON_PREVIEW_IFD = 0x0011;
const TAG_OLYMPUS_CAMERA_SETTINGS = 0x2020;
const TAG_OLYMPUS_PREVIEW_START = 0x0101;
const TAG_OLYMPUS_PREVIEW_LENGTH = 0x0102;

/** TIFF compression codes of JPEG strips: JPEG (old style), JPEG, and JPEG in some Sony and Pentax files. */
const JPEG_COMPRESSIONS = new Set([6, 7, 99]);

const MAX_IFDS = 64;
const MAX_IFD_ENTRIES = 512;
const MAX_SUB_IFDS = 16;

interface TiffHeader {
  littleEndian: boolean;
  magic: number;
  /** File offset that the header's offsets are relative to (the header's own position). */
  base: number;
  /** File offset of IFD0. */
  firstIfd: number;
}

interface Entry {
  type: number;
  count: number;
  /** The entry's 4-byte value field: the value itself when it fits, else its offset. */
  value: Uint8Array;
}

interface Ifd {
  entries: Map<number, Entry>;
  /** Relative offset of the next IFD (0 for none). */
  next: number;
}

/** Reads a TIFF header from `bytes`, which start at file offset `start`. */
function tiffHeader(bytes: Uint8Array, start: number): TiffHeader | null {
  if (bytes.length < 8) return null;
  const order = ascii(bytes, 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const littleEndian = order === 'II';
  const magic = u16(bytes, 2, littleEndian);
  if (magic !== TIFF_MAGIC && magic !== RW2_MAGIC && !ORF_MAGICS.has(magic)) return null;
  return { littleEndian, magic, base: start, firstIfd: start + u32(bytes, 4, littleEndian) };
}

class TiffReader {
  readonly candidates: Candidate[] = [];
  private readonly visited = new Set<number>();

  constructor(readonly source: ByteSource) {}

  /** Reads the IFD at a file offset; null when it's malformed, already read, or over the limit. */
  async ifd(offset: number, littleEndian: boolean): Promise<Ifd | null> {
    if (this.visited.has(offset) || this.visited.size >= MAX_IFDS) return null;
    this.visited.add(offset);
    const head = await this.source.bytes(offset, 2);
    if (head.length < 2) return null;
    const count = u16(head, 0, littleEndian);
    if (count === 0 || count > MAX_IFD_ENTRIES) return null;
    const data = await this.source.bytes(offset + 2, count * 12 + 4);
    if (data.length < count * 12) return null;
    const entries = new Map<number, Entry>();
    for (let index = 0; index < count; index++) {
      const at = index * 12;
      const tag = u16(data, at, littleEndian);
      if (entries.has(tag)) continue;
      entries.set(tag, { type: u16(data, at + 2, littleEndian), count: u32(data, at + 4, littleEndian), value: data.subarray(at + 8, at + 12) });
    }
    return { entries, next: data.length >= count * 12 + 4 ? u32(data, count * 12, littleEndian) : 0 };
  }

  /** Records the JPEG an IFD points at: a JPEGInterchangeFormat pair, or a single JPEG-compressed strip. */
  collect(ifd: Ifd, littleEndian: boolean, base: number): void {
    const value = (tag: number) => scalar(ifd.entries.get(tag), littleEndian);
    const jpegOffset = value(TAG_JPEG_OFFSET);
    const jpegLength = value(TAG_JPEG_LENGTH);
    if (jpegOffset && jpegLength) this.candidates.push({ offset: base + jpegOffset, length: jpegLength });

    const strips = ifd.entries.get(TAG_STRIP_OFFSETS);
    const stripLengths = ifd.entries.get(TAG_STRIP_BYTE_COUNTS);
    const compression = value(TAG_COMPRESSION);
    if (strips?.count === 1 && stripLengths?.count === 1 && compression !== null && JPEG_COMPRESSIONS.has(compression)) {
      const offset = scalar(strips, littleEndian);
      const length = scalar(stripLengths, littleEndian);
      if (offset && length) this.candidates.push({ offset: base + offset, length });
    }
  }

  /** File offsets of an IFD's sub-IFDs (SubIFDs tag). */
  async subIfds(entry: Entry, littleEndian: boolean, base: number): Promise<number[]> {
    if (entry.type !== LONG && entry.type !== IFD) return [];
    const pointer = u32(entry.value, 0, littleEndian);
    if (entry.count === 1) return [base + pointer];
    const data = await this.source.bytes(base + pointer, Math.min(entry.count, MAX_SUB_IFDS) * 4);
    const offsets: number[] = [];
    for (let at = 0; at + 4 <= data.length; at += 4) offsets.push(base + u32(data, at, littleEndian));
    return offsets;
  }
}

async function scanTiff(source: ByteSource, header: TiffHeader): Promise<Scan> {
  const reader = new TiffReader(source);
  const { littleEndian, base } = header;
  let orientation: number | null = null;
  let offset = header.firstIfd;
  for (let index = 0; offset > base && index < MAX_IFDS; index++) {
    const ifd = await reader.ifd(offset, littleEndian);
    if (!ifd) break;
    if (index === 0) {
      orientation = validOrientation(scalar(ifd.entries.get(TAG_ORIENTATION), littleEndian));
      const rw2 = ifd.entries.get(TAG_RW2_JPEG);
      if (header.magic === RW2_MAGIC && rw2?.type === UNDEFINED && rw2.count > 4) {
        reader.candidates.push({ offset: base + u32(rw2.value, 0, littleEndian), length: rw2.count });
      }
    }
    reader.collect(ifd, littleEndian, base);

    const subIfds = ifd.entries.get(TAG_SUB_IFDS);
    for (const subOffset of subIfds ? await reader.subIfds(subIfds, littleEndian, base) : []) {
      const sub = await reader.ifd(subOffset, littleEndian);
      if (sub) reader.collect(sub, littleEndian, base);
    }

    const exif = ifd.entries.get(TAG_EXIF_IFD);
    const exifIfd = exif ? await reader.ifd(base + u32(exif.value, 0, littleEndian), littleEndian) : null;
    const makerNote = exifIfd?.entries.get(TAG_MAKER_NOTE);
    if (makerNote && makerNote.count > 16) await scanMakerNote(reader, base + u32(makerNote.value, 0, littleEndian));

    offset = ifd.next ? base + ifd.next : 0;
  }
  return { candidates: reader.candidates, orientation };
}

/** Previews in maker notes: Nikon's PreviewIFD (older and truncated NEFs) and Olympus's only full-size preview. */
async function scanMakerNote(reader: TiffReader, start: number): Promise<void> {
  const head = await reader.source.bytes(start, 18);
  if (ascii(head, 0, 6) === 'Nikon\0' && head[6] === 2) {
    // "Nikon\0", version, then a TIFF structure whose offsets are relative to its own header.
    const header = tiffHeader(head.subarray(10), start + 10);
    if (!header || header.magic !== TIFF_MAGIC) return;
    const main = await reader.ifd(header.firstIfd, header.littleEndian);
    const pointer = main?.entries.get(TAG_NIKON_PREVIEW_IFD);
    if (!pointer) return;
    const preview = await reader.ifd(header.base + u32(pointer.value, 0, header.littleEndian), header.littleEndian);
    if (preview) reader.collect(preview, header.littleEndian, header.base);
    return;
  }

  // Olympus and OM System: a byte order mark and an IFD; offsets are relative to the start of the maker note.
  let ifdStart: number;
  if (ascii(head, 0, 8) === 'OLYMPUS\0') ifdStart = 12;
  else if (ascii(head, 0, 12) === 'OM SYSTEM\0\0\0') ifdStart = 16;
  else return;
  const order = ascii(head, ifdStart - 4, 2);
  if (order !== 'II' && order !== 'MM') return;
  const littleEndian = order === 'II';
  const main = await reader.ifd(start + ifdStart, littleEndian);
  const pointer = main?.entries.get(TAG_OLYMPUS_CAMERA_SETTINGS);
  if (!pointer) return;
  const settings = await reader.ifd(start + u32(pointer.value, 0, littleEndian), littleEndian);
  if (!settings) return;
  const offset = scalar(settings.entries.get(TAG_OLYMPUS_PREVIEW_START), littleEndian);
  const length = scalar(settings.entries.get(TAG_OLYMPUS_PREVIEW_LENGTH), littleEndian);
  if (offset && length) reader.candidates.push({ offset: start + offset, length });
}

function scalar(entry: Entry | undefined, littleEndian: boolean): number | null {
  if (!entry || entry.count < 1) return null;
  if (entry.type === SHORT) return u16(entry.value, 0, littleEndian);
  if (entry.type === LONG || entry.type === IFD) return u32(entry.value, 0, littleEndian);
  return null;
}

function validOrientation(value: number | null): number | null {
  return value !== null && value >= 1 && value <= 8 ? value : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Canon CR3 (ISO base media file): the first track is the full-size JPEG; the CMT1 box is a TIFF IFD0 with the
// orientation.

const CANON_UUID = '85c0b687820f11e08111f4ce462b6a48';
const MAX_BOXES = 64;

interface Box {
  type: string;
  /** File offsets of the box's content. */
  start: number;
  end: number;
}

async function scanCr3(source: ByteSource): Promise<Scan> {
  const scan: Scan = { candidates: [], orientation: null };
  const moov = (await childBoxes(source, 0, source.size)).find((box) => box.type === 'moov');
  if (!moov) return scan;
  const children = await childBoxes(source, moov.start, moov.end);

  for (const box of children) {
    if (box.type !== 'uuid' || hex(await source.bytes(box.start, 16)) !== CANON_UUID) continue;
    const cmt1 = (await childBoxes(source, box.start + 16, box.end)).find((child) => child.type === 'CMT1');
    if (cmt1) scan.orientation = await tiffOrientation(source, cmt1.start);
  }

  let stbl = children.find((box) => box.type === 'trak');
  for (const type of ['mdia', 'minf', 'stbl']) {
    stbl = stbl && (await childBoxes(source, stbl.start, stbl.end)).find((box) => box.type === type);
  }
  if (!stbl) return scan;
  const tables = await childBoxes(source, stbl.start, stbl.end);
  const sizes = tables.find((box) => box.type === 'stsz');
  const chunks = tables.find((box) => box.type === 'co64' || box.type === 'stco');
  if (!sizes || !chunks) return scan;

  // stsz: version/flags, sample size (0 when each sample has its own), sample count, sizes…
  const stsz = await source.bytes(sizes.start, 16);
  const length = stsz.length >= 12 && u32(stsz, 4, false) > 0 ? u32(stsz, 4, false) : stsz.length >= 16 ? u32(stsz, 12, false) : 0;
  // co64/stco: version/flags, entry count, 64- or 32-bit chunk offsets…
  const table = await source.bytes(chunks.start, 16);
  const wide = chunks.type === 'co64';
  if (table.length < (wide ? 16 : 12) || u32(table, 4, false) < 1) return scan;
  const offset = wide ? u32(table, 8, false) * 2 ** 32 + u32(table, 12, false) : u32(table, 8, false);
  scan.candidates.push({ offset, length });
  return scan;
}

/** Boxes within [start, end) of the file. */
async function childBoxes(source: ByteSource, start: number, end: number): Promise<Box[]> {
  const boxes: Box[] = [];
  for (let at = start; at + 8 <= end && boxes.length < MAX_BOXES; ) {
    const head = await source.bytes(at, 16);
    if (head.length < 8) break;
    let size = u32(head, 0, false);
    let headerSize = 8;
    if (size === 1) {
      if (head.length < 16) break;
      size = u32(head, 8, false) * 2 ** 32 + u32(head, 12, false);
      headerSize = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < headerSize || at + size > end) break;
    boxes.push({ type: ascii(head, 4, 4), start: at + headerSize, end: at + size });
    at += size;
  }
  return boxes;
}

async function tiffOrientation(source: ByteSource, start: number): Promise<number | null> {
  const header = tiffHeader(await source.bytes(start, 8), start);
  if (!header) return null;
  const ifd = await new TiffReader(source).ifd(header.firstIfd, header.littleEndian);
  return ifd && validOrientation(scalar(ifd.entries.get(TAG_ORIENTATION), header.littleEndian));
}

// ---------------------------------------------------------------------------------------------------------------------
// JPEG

const MAX_JPEG_MARKERS = 256;

/**
 * Walks the JPEG's segments up to its first scan. Accepts 8-bit Huffman JPEGs (baseline, extended, progressive), the
 * kinds browsers decode; rejects truncated streams and the lossless JPEG that Canon and DNG files store RAW data in.
 */
async function inspectJpeg(source: ByteSource, offset: number, length: number): Promise<Jpeg | null> {
  const end = offset + length;
  if (!(offset > 0 && length > 4 && end <= source.size)) return null;
  const soi = await source.bytes(offset, 2);
  if (soi[0] !== 0xff || soi[1] !== 0xd8) return null;
  const exif: Array<[number, number]> = [];
  let size: { width: number; height: number } | null = null;
  let at = offset + 2;
  for (let markers = 0; markers < MAX_JPEG_MARKERS && at + 4 <= end; markers++) {
    const head = await source.bytes(at, 4);
    if (head.length < 4 || head[0] !== 0xff) return null;
    const marker = head[1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // markers without a segment
      continue;
    }
    if (marker === 0xda) return size && { offset, length, ...size, exif }; // start of scan
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) return null;
    const segmentLength = (head[2] << 8) | head[3];
    if (segmentLength < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // Start of frame: precision, height, width.
      const frame = await source.bytes(at + 4, 5);
      if (size || frame.length < 5 || marker > 0xc2 || frame[0] !== 8) return null;
      size = { height: (frame[1] << 8) | frame[2], width: (frame[3] << 8) | frame[4] };
      if (!size.width || !size.height) return null;
    } else if (marker === 0xe1 && ascii(await source.bytes(at + 4, 6), 0, 6) === 'Exif\0\0') {
      exif.push([at, at + 2 + segmentLength]);
    }
    at += 2 + segmentLength;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading

const BLOCK_SIZE = 64 * 1024;
/** RAW metadata is a few small blocks; a file needing more than this is malformed. */
const MAX_BLOCKS = 128;
const EMPTY = new Uint8Array(0);

/** Random access to a Blob's bytes in cached blocks, so that parsing reads only the metadata, not the whole file. */
class ByteSource {
  private readonly blocks = new Map<number, Promise<Uint8Array>>();

  constructor(private readonly blob: Blob) {}

  get size(): number {
    return this.blob.size;
  }

  /** Bytes [offset, offset + length), fewer at the end of the file, none when out of range. */
  async bytes(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(offset + length, this.blob.size);
    if (!Number.isSafeInteger(offset) || offset < 0 || !(end > offset)) return EMPTY;
    const first = Math.floor(offset / BLOCK_SIZE);
    const last = Math.floor((end - 1) / BLOCK_SIZE);
    if (first === last) return (await this.block(first)).subarray(offset - first * BLOCK_SIZE, end - first * BLOCK_SIZE);
    const bytes = new Uint8Array(end - offset);
    for (let index = first; index <= last; index++) {
      const block = await this.block(index);
      const blockStart = index * BLOCK_SIZE;
      const from = Math.max(offset, blockStart);
      bytes.set(block.subarray(from - blockStart, Math.min(end, blockStart + block.length) - blockStart), from - offset);
    }
    return bytes;
  }

  private block(index: number): Promise<Uint8Array> {
    let block = this.blocks.get(index);
    if (!block) {
      if (this.blocks.size >= MAX_BLOCKS) throw new Error('RAW metadata is too spread out');
      const start = index * BLOCK_SIZE;
      block = this.blob
        .slice(start, Math.min(start + BLOCK_SIZE, this.blob.size))
        .arrayBuffer()
        .then((buffer) => new Uint8Array(buffer));
      this.blocks.set(index, block);
    }
    return block;
  }
}

function u16(bytes: Uint8Array, at: number, littleEndian: boolean): number {
  return littleEndian ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
}

function u32(bytes: Uint8Array, at: number, littleEndian: boolean): number {
  return littleEndian
    ? bytes[at] + bytes[at + 1] * 0x100 + bytes[at + 2] * 0x10000 + bytes[at + 3] * 0x1000000
    : bytes[at] * 0x1000000 + bytes[at + 1] * 0x10000 + bytes[at + 2] * 0x100 + bytes[at + 3];
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
