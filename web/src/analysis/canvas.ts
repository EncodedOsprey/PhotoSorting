// Canvas helpers: high-quality downscaling and pixel/JPEG export with bounded memory.
// iOS Safari limits each canvas to 16.7 MP and all canvases together to ~384 MB, and only frees a canvas's
// pixels on garbage collection, so the analyzer reuses a few canvases and shrinks them to 0×0 when done.

/** Largest canvas area we create (iOS Safari rejects canvases above 16,777,216 pixels). */
export const MAX_CANVAS_AREA = 16_000_000;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Size scaled to fit a long edge of maxEdge (never upscaled), at least 1×1. */
export function fitWithin(width: number, height: number, maxEdge: number): Size {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Creates a detached canvas. Its 2D context is created right away so the willReadFrequently hint (CPU-backed
 * canvas, fast getImageData) sticks: the attributes of the first getContext() call win.
 */
export function createCanvas(willReadFrequently = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 0;
  canvas.height = 0;
  canvas.getContext('2d', { willReadFrequently });
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');
  return context;
}

/** Resizes (and thereby clears) the canvas; returns it for chaining. */
export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  if (width * height > MAX_CANVAS_AREA) throw new RangeError(`Canvas ${width}×${height} is too large`);
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Releases the canvas's pixel memory immediately (instead of at garbage collection). */
export function freeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Draws `region` of `source` into `target` (resized to width×height) with high-quality smoothing. Large
 * reductions go through repeated halving (≤2× per step) on two scratch canvases: a single big step with
 * imageSmoothingQuality 'high' aliases differently in Safari and Chrome, halving gives the same result in both.
 */
export class Resampler {
  private readonly scratch = [createCanvas(), createCanvas()];

  draw(source: CanvasImageSource, region: Rect, target: HTMLCanvasElement, width: number, height: number): void {
    let current: CanvasImageSource = source;
    let { x, y, width: w, height: h } = region;
    for (let step = 0; w > width * 2 || h > height * 2; step++) {
      let nextWidth = Math.max(width, Math.ceil(w / 2));
      let nextHeight = Math.max(height, Math.ceil(h / 2));
      if (nextWidth * nextHeight > MAX_CANVAS_AREA) {
        // Only for huge panoramas: take a bigger first step to stay within the canvas size limit.
        const shrink = Math.sqrt(MAX_CANVAS_AREA / (nextWidth * nextHeight));
        nextWidth = Math.max(width, Math.floor(nextWidth * shrink));
        nextHeight = Math.max(height, Math.floor(nextHeight * shrink));
      }
      const canvas = resizeCanvas(this.scratch[step % 2], nextWidth, nextHeight);
      drawSmooth(context2d(canvas), current, x, y, w, h, nextWidth, nextHeight);
      current = canvas;
      x = 0;
      y = 0;
      w = nextWidth;
      h = nextHeight;
    }
    const context = context2d(resizeCanvas(target, width, height));
    // Transparent images (PNG) are analyzed and thumbnailed on white.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    drawSmooth(context, current, x, y, w, h, width, height);
  }

  /** Frees the scratch canvases' memory (they are reallocated on the next draw). */
  free(): void {
    this.scratch.forEach(freeCanvas);
  }
}

function drawSmooth(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): void {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, x, y, width, height, 0, 0, targetWidth, targetHeight);
}

/** RGBA pixels of the whole canvas (create it with willReadFrequently = true). */
export function readPixels(canvas: HTMLCanvasElement): ImageData {
  return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

/** Encodes the canvas as JPEG and returns an object URL (the caller revokes it). */
export async function canvasToJpegUrl(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('JPEG encoding failed');
  return URL.createObjectURL(blob);
}
