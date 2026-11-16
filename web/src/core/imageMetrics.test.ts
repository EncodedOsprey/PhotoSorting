import { describe, expect, it } from 'vitest';
import { exposureScore, laplacianVariance, sharpnessScore, sharpnessScoreFromGray, toGrayscale } from './imageMetrics';

const image = (width: number, height: number, pixel: (x: number, y: number) => number) =>
  Uint8Array.from({ length: width * height }, (_, i) => pixel(i % width, Math.floor(i / width)));

describe('toGrayscale', () => {
  it('computes rounded BT.601 luma and ignores alpha', () => {
    const rgba = [255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 255, 255, 255, 255, 10, 200, 30, 7, 0, 0, 0, 0];
    expect(Array.from(toGrayscale(rgba, 3, 2))).toEqual([76, 150, 29, 255, 124, 0]);
  });

  it('rejects buffers that are too short for the size', () => {
    expect(() => toGrayscale(new Uint8ClampedArray(15), 2, 2)).toThrow(RangeError);
    expect(toGrayscale(new Uint8ClampedArray(0), 0, 0)).toHaveLength(0);
  });
});

describe('laplacianVariance', () => {
  const size = 32;

  it('is zero on a flat image and higher on fine detail than on a smooth gradient', () => {
    expect(laplacianVariance(image(size, size, () => 128), size, size)).toBe(0);
    const checker = laplacianVariance(image(size, size, (x, y) => ((x + y) % 2 === 0 ? 0 : 255)), size, size);
    const gradient = laplacianVariance(image(size, size, (x) => x * 8), size, size);
    expect(checker).toBeGreaterThan(gradient);
    expect(laplacianVariance([1, 2, 3, 4], 2, 2)).toBe(0);
  });

  it('uses the 4-neighbour kernel and the population variance over interior pixels', () => {
    // Interior Laplacians of this 5×3 image are 100, -400 and 100.
    const spot = image(5, 3, (x, y) => (x === 2 && y === 1 ? 100 : 0));
    expect(laplacianVariance(spot, 5, 3)).toBeCloseTo(180000 / 3 - (200 / 3) ** 2, 9);
  });
});

describe('sharpnessScore', () => {
  it('increases with Laplacian variance and saturates below 1', () => {
    expect(sharpnessScore(500)).toBeGreaterThan(sharpnessScore(50));
    expect(sharpnessScore(1e9)).toBeLessThanOrEqual(1);
    expect(sharpnessScore(0)).toBe(0);
    expect(sharpnessScore(Number.NaN)).toBe(0);
  });

  it('can be computed straight from grayscale pixels', () => {
    const checker = image(8, 8, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));
    expect(sharpnessScoreFromGray(checker, 8, 8)).toBe(sharpnessScore(laplacianVariance(checker, 8, 8)));
  });
});

describe('exposureScore', () => {
  it('prefers mid-gray to black or white', () => {
    const mid = exposureScore(new Uint8Array(100).fill(128));
    expect(mid).toBeGreaterThan(0.9);
    expect(mid).toBeGreaterThan(exposureScore(new Uint8Array(100)));
    expect(mid).toBeGreaterThan(exposureScore(new Uint8Array(100).fill(255)));
    expect(exposureScore([])).toBe(0);
  });

  it('penalizes clipped highlights and crushed shadows even when the mean is ideal', () => {
    const halfClipped = Uint8Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0 : 255));
    expect(exposureScore(halfClipped)).toBe(0);
  });
});
