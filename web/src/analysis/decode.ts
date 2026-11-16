// Decoding picked files into drawable, EXIF-oriented images.
import { findRawPreview } from './rawPreview';

/** The browser could not decode the file (unsupported format, corrupt or truncated data). */
export class ImageDecodeError extends Error {
  constructor(message = "This image format can't be opened in this browser") {
    super(message);
    this.name = 'ImageDecodeError';
  }
}

export interface DecodedImage {
  /** Draw with drawImage(); EXIF orientation is already applied by the browser. */
  readonly image: HTMLImageElement;
  /** Oriented pixel size. */
  readonly width: number;
  readonly height: number;
  /** Revokes the object URL and drops the decoded pixels. Call right after drawing. Idempotent. */
  release(): void;
}

/**
 * Decodes an image file with an <img> element, which applies EXIF orientation (naturalWidth/naturalHeight and
 * drawImage() use the oriented image in Safari and Chrome) and decodes HEIC where the browser supports it. Camera RAW
 * files are decoded from the largest JPEG preview they embed, or as-is if that fails.
 * Rejects with ImageDecodeError when the browser can't decode the file.
 */
export async function decodeImage(file: Blob): Promise<DecodedImage> {
  const preview = await findRawPreview(file);
  if (preview) {
    try {
      return await decodeBlob(preview.blob);
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
    }
  }
  return decodeBlob(file);
}

async function decodeBlob(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    URL.revokeObjectURL(url);
    image.removeAttribute('src');
  };

  image.src = url;
  try {
    await image.decode();
  } catch {
    release();
    throw new ImageDecodeError();
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!(width > 0 && height > 0)) {
    release();
    throw new ImageDecodeError();
  }
  return { image, width, height, release };
}
