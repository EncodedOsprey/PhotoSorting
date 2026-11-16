import { describe, expect, it } from 'vitest';
import { laplacianVariance, sharpnessScore } from '../core';
import { isLikelyScreenshot, MIN_REGION_SIDE, padBox, regionSharpness } from './metrics';

describe('padBox', () => {
  it('grows the box on every side, snapped outwards and clipped to the image', () => {
    expect(padBox({ x: 10.5, y: 10.25, width: 20, height: 8 }, 0.25, 100, 100)).toEqual({ x: 5, y: 8, width: 31, height: 13 });
    expect(padBox({ x: 0, y: 95, width: 20, height: 10 }, 0.5, 100, 100)).toEqual({ x: 0, y: 90, width: 30, height: 10 });
  });
});

describe('regionSharpness', () => {
  // A 512×384 image that is flat (out of focus) except for a finely textured "face" region.
  const width = 512;
  const height = 384;
  const face = { x: 200, y: 120, width: 110, height: 130 };
  const gray = new Uint8Array(width * height).fill(120);
  for (let y = face.y; y < face.y + face.height; y++) {
    for (let x = face.x; x < face.x + face.width; x++) gray[y * width + x] = (x * 7 + y * 13) % 5 === 0 ? 200 : 90;
  }

  it('scores a sharp subject on a soft background higher than the whole image', () => {
    const whole = sharpnessScore(laplacianVariance(gray, width, height));
    const region = regionSharpness(gray, width, height, face)!;
    expect(region).toBeGreaterThan(whole);
    expect(regionSharpness(gray, width, height, { x: 20, y: 20, width: 80, height: 80 })).toBe(0);
  });

  it('declines regions too small to judge', () => {
    expect(regionSharpness(gray, width, height, { x: 0, y: 0, width: MIN_REGION_SIDE / 2, height: MIN_REGION_SIDE / 2 })).toBeNull();
  });
});

describe('isLikelyScreenshot', () => {
  const png = { name: 'IMG_0042.PNG', type: 'image/png' };

  it('flags PNGs at an iPhone screen size without a capture date', () => {
    expect(isLikelyScreenshot(png, 1179, 2556, false)).toBe(true);
    expect(isLikelyScreenshot(png, 2556, 1179, false)).toBe(true);
    expect(isLikelyScreenshot({ name: 'shot.png', type: '' }, 1170, 2532, false)).toBe(true);
  });

  it('never flags camera photos', () => {
    expect(isLikelyScreenshot(png, 1179, 2556, true)).toBe(false);
    expect(isLikelyScreenshot({ name: 'IMG_0001.JPG', type: 'image/jpeg' }, 1179, 2556, false)).toBe(false);
    expect(isLikelyScreenshot(png, 3024, 4032, false)).toBe(false);
  });
});
