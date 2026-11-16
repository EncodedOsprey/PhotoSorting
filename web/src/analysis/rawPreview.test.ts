import exifr from 'exifr';
import { describe, expect, it } from 'vitest';
import { findRawPreview } from './rawPreview';

const SHORT = 3;
const LONG = 4;
const UNDEFINED = 7;
const IFD = 13;

type IfdEntry = [tag: number, type: number, count: number, value: number];

/** Writes TIFF structures at explicit offsets of a zero-filled buffer. */
class Writer {
  readonly bytes: Uint8Array<ArrayBuffer>;
  private readonly view: DataView;

  constructor(
    size: number,
    private readonly littleEndian: boolean,
  ) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  put(at: number, data: Uint8Array | string): this {
    this.bytes.set(typeof data === 'string' ? ascii(data) : data, at);
    return this;
  }

  /** TIFF header at `at`, IFD0 at `at + 8`. */
  header(at: number, magic = 42): this {
    this.put(at, this.littleEndian ? 'II' : 'MM');
    this.view.setUint16(at + 2, magic, this.littleEndian);
    this.view.setUint32(at + 4, 8, this.littleEndian);
    return this;
  }

  ifd(at: number, entries: IfdEntry[], next = 0): this {
    this.view.setUint16(at, entries.length, this.littleEndian);
    entries.forEach(([tag, type, count, value], index) => {
      const entry = at + 2 + index * 12;
      this.view.setUint16(entry, tag, this.littleEndian);
      this.view.setUint16(entry + 2, type, this.littleEndian);
      this.view.setUint32(entry + 4, count, this.littleEndian);
      if (type === SHORT) this.view.setUint16(entry + 8, value, this.littleEndian);
      else this.view.setUint32(entry + 8, value, this.littleEndian);
    });
    this.view.setUint32(at + 2 + entries.length * 12, next, this.littleEndian);
    return this;
  }
}

function ascii(text: string) {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  parts.reduce((at, part) => (bytes.set(part, at), at + part.length), 0);
  return bytes;
}

function u32be(value: number) {
  return Uint8Array.of(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

/** EXIF (APP1) segment with an orientation, little-endian unlike the one findRawPreview writes. */
function exifSegment(orientation: number) {
  return Uint8Array.of(
    ...[0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00],
    ...[0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00],
    ...[0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00],
    ...[0x00, 0x00, 0x00, 0x00],
  );
}

/** The segments of a JPEG up to its first scan (sizes, not image data), optionally with EXIF. */
function jpeg(width: number, height: number, { frame = 0xc0, orientation }: { frame?: number; orientation?: number } = {}) {
  return concat(
    Uint8Array.of(0xff, 0xd8),
    orientation ? exifSegment(orientation) : new Uint8Array(0),
    Uint8Array.of(0xff, 0xdb, 0x00, 0x04, 0x00, 0x00),
    Uint8Array.of(0xff, frame, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3),
    Uint8Array.of(1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1),
    Uint8Array.of(0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0),
    Uint8Array.of(0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9),
  );
}

/**
 * A NEF laid out like Nikon's: orientation in IFD0, the full-size JPEG in a SubIFD and a small one in the maker note's
 * PreviewIFD (offsets relative to the maker note's own TIFF header at 410).
 */
function nef({ orientation = 1, preview, makerNotePreview }: { orientation?: number; preview?: Uint8Array; makerNotePreview?: Uint8Array }) {
  const writer = new Writer(5000 + (preview?.length ?? 0), false).header(0);
  writer.ifd(8, [
    [0x0112, SHORT, 1, orientation],
    ...(preview ? [[0x014a, LONG, 1, 200] satisfies IfdEntry] : []),
    [0x8769, LONG, 1, 300],
  ]);
  if (preview) writer.ifd(200, [[0x0201, LONG, 1, 5000], [0x0202, LONG, 1, preview.length]]).put(5000, preview);
  writer.ifd(300, [[0x927c, UNDEFINED, 64, 400]]);
  writer.put(400, 'Nikon\0').put(406, Uint8Array.of(2, 0x10, 0, 0)).header(410);
  writer.ifd(418, [[0x0011, LONG, 1, 100]]);
  if (makerNotePreview) writer.ifd(510, [[0x0201, LONG, 1, 1590], [0x0202, LONG, 1, makerNotePreview.length]]).put(2000, makerNotePreview);
  return writer.bytes;
}

async function bytesOf(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function orientationOf(blob: Blob): Promise<number | undefined> {
  const tags = await exifr.parse(Buffer.from(await bytesOf(blob)), { pick: ['Orientation'], translateValues: false });
  return tags?.Orientation;
}

function countExifSegments(bytes: Uint8Array): number {
  let count = 0;
  for (let at = 2; bytes[at + 1] !== 0xda; at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3])) {
    if (bytes[at + 1] === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'Exif') count += 1;
  }
  return count;
}

describe('findRawPreview', () => {
  it('picks the largest JPEG of a NEF and gives it the file orientation', async () => {
    const full = jpeg(4000, 3000);
    const file = new File([nef({ orientation: 6, preview: full, makerNotePreview: jpeg(640, 424) })], 'DSC_0001.NEF');
    const preview = await findRawPreview(file);
    expect(preview).toMatchObject({ width: 4000, height: 3000 });
    expect(preview!.blob.type).toBe('image/jpeg');
    const bytes = await bytesOf(preview!.blob);
    expect(await orientationOf(preview!.blob)).toBe(6);
    expect(bytes.subarray(38)).toEqual(full.subarray(2)); // after SOI and the 36-byte EXIF segment
  });

  it("uses the maker note's preview when it's the only one", async () => {
    const preview = await findRawPreview(new File([nef({ makerNotePreview: jpeg(640, 424) })], 'DSC_0001.NEF'));
    expect(preview).toMatchObject({ width: 640, height: 424 });
    expect(await bytesOf(preview!.blob)).toEqual(jpeg(640, 424)); // orientation 1, no EXIF: used as-is
  });

  it("replaces the preview's own EXIF with the file orientation", async () => {
    const file = new File([nef({ orientation: 8, preview: jpeg(4000, 3000, { orientation: 1 }) })], 'DSC_0001.NEF');
    const bytes = await bytesOf((await findRawPreview(file))!.blob);
    expect(countExifSegments(bytes)).toBe(1);
    expect(await orientationOf(new Blob([bytes]))).toBe(8);
  });

  it('skips the lossless JPEG that holds the raw data of CR2 files', async () => {
    const writer = new Writer(2100, true).header(0);
    writer.ifd(8, [[0x0103, SHORT, 1, 6], [0x0111, LONG, 1, 1000], [0x0117, LONG, 1, jpeg(5472, 3648).length]], 200);
    writer.ifd(200, [[0x0103, SHORT, 1, 6], [0x0111, LONG, 1, 2000], [0x0117, LONG, 1, jpeg(6000, 4000).length]]);
    writer.put(1000, jpeg(5472, 3648)).put(2000, jpeg(6000, 4000, { frame: 0xc3 }));
    expect(await findRawPreview(new File([writer.bytes], 'IMG_0001.CR2'))).toMatchObject({ width: 5472, height: 3648 });
  });

  it("reads CR3 files: the first track's JPEG, with the orientation from CMT1", async () => {
    const box = (type: string, ...content: Uint8Array[]) => {
      const body = concat(...content);
      return concat(u32be(body.length + 8), ascii(type), body);
    };
    const cmt1 = new Writer(26, true).header(0).ifd(8, [[0x0112, SHORT, 1, 3]]).bytes;
    const canon = Uint8Array.of(0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48);
    const image = jpeg(6000, 4000);
    const file = (offset: number) =>
      concat(
        box('ftyp', ascii('crx '), u32be(1), ascii('crx isom')),
        box(
          'moov',
          box('uuid', canon, box('CMT1', cmt1)),
          box('trak', box('mdia', box('minf', box('stbl', box('stsz', u32be(0), u32be(0), u32be(1), u32be(image.length)), box('co64', u32be(0), u32be(1), u32be(0), u32be(offset)))))),
        ),
        box('mdat', image),
      );
    const bytes = file(file(0).length - image.length);
    const preview = await findRawPreview(new File([bytes], 'IMG_0001.CR3'));
    expect(preview).toMatchObject({ width: 6000, height: 4000 });
    expect(await orientationOf(preview!.blob)).toBe(3);
  });

  it("leaves the JPEG of RAF files as it is: it has the file's EXIF", async () => {
    const image = jpeg(1920, 1280, { orientation: 6 });
    const bytes = new Writer(160 + image.length, false).put(0, 'FUJIFILMCCD-RAW ').put(84, u32be(160)).put(88, u32be(image.length)).put(160, image).bytes;
    const preview = await findRawPreview(new File([bytes], 'DSCF0001.RAF'));
    expect(preview).toMatchObject({ width: 1920, height: 1280 });
    expect(await bytesOf(preview!.blob)).toEqual(image);
  });

  it("reads ORF previews from Olympus maker notes and RW2's JpgFromRaw", async () => {
    // Olympus maker note at 200: offsets relative to it; CameraSettings at 300 points at the preview at 1200.
    const orf = new Writer(1200 + jpeg(3200, 2400).length, true).header(0, 0x4f52);
    orf.ifd(8, [[0x8769, LONG, 1, 100]]).ifd(100, [[0x927c, UNDEFINED, 64, 200]]);
    orf.put(200, 'OLYMPUS\0II').put(210, Uint8Array.of(3, 0)).ifd(212, [[0x2020, IFD, 1, 100]]);
    orf.ifd(300, [[0x0100, LONG, 1, 1], [0x0101, LONG, 1, 1000], [0x0102, LONG, 1, jpeg(3200, 2400).length]]).put(1200, jpeg(3200, 2400));
    expect(await findRawPreview(new File([orf.bytes], 'P1010001.ORF'))).toMatchObject({ width: 3200, height: 2400 });

    const rw2 = new Writer(100 + jpeg(1920, 1440).length, true).header(0, 0x55);
    rw2.ifd(8, [[0x002e, UNDEFINED, jpeg(1920, 1440).length, 100]]).put(100, jpeg(1920, 1440));
    expect(await findRawPreview(new File([rw2.bytes], 'P1000001.RW2'))).toMatchObject({ width: 1920, height: 1440 });
  });

  it('returns null for other files and malformed RAW files', async () => {
    const raw = nef({ preview: jpeg(4000, 3000) });
    expect(await findRawPreview(new File([raw], 'photo.jpg'))).toBeNull(); // not read: browsers decode JPEG
    expect(await findRawPreview(new File([jpeg(4000, 3000)], 'upload'))).toBeNull();
    expect(await findRawPreview(new File([ascii('not a raw file, just text '.repeat(50))], 'notes.nef'))).toBeNull();
    expect(await findRawPreview(new File([raw.subarray(0, raw.length - 100)], 'truncated.nef'))).toBeNull();
    const cyclic = new Writer(100, true).header(0).ifd(8, [[0x0112, SHORT, 1, 1]], 8).bytes; // IFD0's next IFD is itself
    expect(await findRawPreview(new File([cyclic], 'cyclic.dng'))).toBeNull();
  });
});
