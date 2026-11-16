import { describe, expect, it } from 'vitest';
import { copyRect, downscaleArea, fillRect, pixelRect, type Pixels } from './pixels';

/** RGBA image whose channels are given per pixel by `value(x, y)` (alpha 255). */
function image(width: number, height: number, value: (x: number, y: number) => number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data.set([value(x, y), value(x, y), value(x, y), 255], offset);
    }
  }
  return { data, width, height };
}

const reds = (data: Uint8ClampedArray) => Array.from(data.filter((_, i) => i % 4 === 0));

describe('pixelRect', () => {
  it('rounds outwards and clips to the image', () => {
    expect(pixelRect({ x: 1.5, y: 2.2, width: 3, height: 4 }, 10, 10)).toEqual({ x: 1, y: 2, width: 4, height: 5 });
    expect(pixelRect({ x: -3, y: 8, width: 5, height: 5 }, 10, 10)).toEqual({ x: 0, y: 8, width: 2, height: 2 });
    expect(pixelRect({ x: 20, y: 0, width: 5, height: 5 }, 10, 10).width).toBe(0);
  });
});

describe('downscaleArea', () => {
  it('copies exactly at the same size', () => {
    const source = image(5, 3, (x, y) => 17 * x + 50 * y);
    expect(downscaleArea(source, { x: 0, y: 0, width: 5, height: 3 }, 5, 3)).toEqual(source.data);
  });

  it('averages the covered source pixels, weighted by coverage', () => {
    const halves = image(4, 2, (x, y) => [10, 20, 30, 50][x] + 100 * y);
    expect(reds(downscaleArea(halves, { x: 0, y: 0, width: 4, height: 2 }, 2, 1))).toEqual([65, 90]);
    const row = image(3, 1, (x) => [0, 90, 180][x]);
    expect(reds(downscaleArea(row, { x: 0, y: 0, width: 3, height: 1 }, 2, 1))).toEqual([30, 150]);
  });

  it('reads only the given rectangle', () => {
    const source = image(4, 4, (x, y) => 10 * (y * 4 + x));
    expect(reds(downscaleArea(source, { x: 2, y: 2, width: 2, height: 2 }, 1, 1))).toEqual([125]);
  });

  it('preserves the mean brightness at any scale factor', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) % 256;
    const source = image(37, 23, () => random());
    const output = downscaleArea(source, { x: 0, y: 0, width: 37, height: 23 }, 10, 7);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(reds(output))).toBeCloseTo(mean(reds(source.data)), 0);
  });

  it('refuses to upscale or produce an empty image', () => {
    const source = image(4, 4, () => 0);
    expect(() => downscaleArea(source, { x: 0, y: 0, width: 4, height: 4 }, 5, 4)).toThrow(RangeError);
    expect(() => downscaleArea(source, { x: 0, y: 0, width: 4, height: 4 }, 0, 4)).toThrow(RangeError);
  });
});

describe('copyRect', () => {
  it('copies a rectangle into a rect-sized target', () => {
    const source = image(4, 3, (x, y) => 10 * y + x);
    const target = { data: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2 };
    copyRect(source, { x: 1, y: 1, width: 2, height: 2 }, target);
    expect(reds(target.data)).toEqual([11, 12, 21, 22]);
    expect(() => copyRect(source, { x: 0, y: 0, width: 3, height: 2 }, target)).toThrow(RangeError);
  });
});

describe('fillRect', () => {
  it('fills the part inside the image with opaque gray', () => {
    const target = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    fillRect(target, { x: 2.5, y: -1, width: 5, height: 2 }, 128);
    const filled = [];
    for (let i = 0; i < 16; i++) if (target.data[i * 4 + 3] === 255) filled.push(i);
    expect(filled).toEqual([2, 3]);
    expect(Array.from(target.data.subarray(8, 12))).toEqual([128, 128, 128, 255]);
  });
});
