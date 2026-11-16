// Larger previews for the detail view, decoded on demand from the original file.
import { canvasToJpegUrl, createCanvas, fitWithin, freeCanvas, Resampler } from './canvas';
import { decodeImage } from './decode';

const PREVIEW_QUALITY = 0.88;

/**
 * Decodes the file (EXIF orientation applied), downscales it to fit maxEdge and returns an object URL of a JPEG.
 * The caller revokes the URL. Rejects with ImageDecodeError ("This image format can't be opened in this browser")
 * when the browser can't decode the file.
 */
export async function createPreviewUrl(file: File, maxEdge = 1600): Promise<string> {
  const decoded = await decodeImage(file);
  const resampler = new Resampler();
  const canvas = createCanvas();
  try {
    const size = fitWithin(decoded.width, decoded.height, maxEdge);
    resampler.draw(decoded.image, { x: 0, y: 0, width: decoded.width, height: decoded.height }, canvas, size.width, size.height);
    decoded.release();
    return await canvasToJpegUrl(canvas, PREVIEW_QUALITY);
  } finally {
    decoded.release();
    resampler.free();
    freeCanvas(canvas);
  }
}
