// Pure photo-level measurements on grayscale buffers (no DOM; unit tested).
import { laplacianVariance, sharpnessScore } from '../core';
import type { Box } from './tiling';

/** Box grown by `fraction` of its size on every side, snapped outwards to whole pixels and clipped to the image. */
export function padBox(box: Box, fraction: number, width: number, height: number): Box {
  const x0 = Math.max(0, Math.floor(box.x - box.width * fraction));
  const y0 = Math.max(0, Math.floor(box.y - box.height * fraction));
  const x1 = Math.min(width, Math.ceil(box.x + box.width * (1 + fraction)));
  const y1 = Math.min(height, Math.ceil(box.y + box.height * (1 + fraction)));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** Copies an integer-aligned rectangle out of a row-major grayscale buffer. */
export function cropGray(gray: Uint8Array, width: number, rect: Box): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row++) {
    const start = (rect.y + row) * width + rect.x;
    out.set(gray.subarray(start, start + rect.width), row * rect.width);
  }
  return out;
}

/** Face regions smaller than this (pixels per side, on the ~512px metrics image) are too small to judge focus. */
export const MIN_REGION_SIDE = 48;

/**
 * core sharpnessScore of a face region (box in metrics-image pixels, padded by 10%) measured on the same ~512px
 * image as the whole-photo score, i.e. at the pixel density the score is calibrated for. Null when too small.
 * Lets a sharp subject in front of a soft (bokeh) background count as a sharp photo.
 */
export function regionSharpness(gray: Uint8Array, width: number, height: number, box: Box): number | null {
  const rect = padBox(box, 0.1, width, height);
  if (rect.width < MIN_REGION_SIDE || rect.height < MIN_REGION_SIDE) return null;
  return sharpnessScore(laplacianVariance(cropGray(gray, width, rect), rect.width, rect.height));
}

/** Screen sizes (portrait, px) of iPhones/iPads since 2014; screenshots are saved at exactly these sizes. */
const SCREEN_SIZES = new Set([
  '640x1136', '750x1334', '828x1792', '1080x1920', '1125x2436', '1170x2532', '1179x2556', '1206x2622',
  '1242x2208', '1242x2688', '1284x2778', '1290x2796', '1320x2868', '1080x2340', '1536x2048', '1620x2160',
  '1640x2360', '1668x2224', '1668x2388', '1488x2266', '2048x2732', '2064x2752',
]);

/**
 * Conservative screenshot test: a PNG without an EXIF capture date whose size matches an iPhone/iPad screen.
 * Camera photos are JPEG/HEIC with EXIF, so this doesn't misfire on real shots.
 */
export function isLikelyScreenshot(file: { name: string; type: string }, width: number, height: number, hasCaptureTime: boolean): boolean {
  if (hasCaptureTime) return false;
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  return isPng && SCREEN_SIZES.has(`${Math.min(width, height)}x${Math.max(width, height)}`);
}
