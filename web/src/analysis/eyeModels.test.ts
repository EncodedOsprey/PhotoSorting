import { describe, expect, it, vi } from 'vitest';
import { createEyeModels, cropDetail, EYE_CORNERS, eyeCrop, headCrop } from './eyeModels';
import type { Pixels } from './pixels';
import type { TinyNet } from './tinyNet';

/** Image whose red channel is the pixel's column and green channel its row, so a crop shows where it sampled. */
function coordinateImage(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([x, y, 0, 255], (y * width + x) * 4);
  return { data, width, height };
}

/** Sampled source column (red) and row (green) at output pixel (u, v) of a CHW tensor. */
function sourceAt(tensor: Float32Array, width: number, height: number, u: number, v: number): { x: number; y: number } {
  const index = v * width + u;
  return { x: tensor[index] * 255, y: tensor[width * height + index] * 255 };
}

describe('eyeCrop', () => {
  const image = coordinateImage(240, 240);

  it('covers 1.2× the corner distance across and 0.6× down, centered between the corners', () => {
    const crop = eyeCrop(image, { x: 80, y: 100 }, { x: 120, y: 100 })!;
    expect(crop).toHaveLength(3 * 24 * 40);
    // 48×24 source pixels from x = 76 and y = 88 (pixel centers at +0.5): 1.2 source pixels per output pixel across.
    expect(sourceAt(crop, 40, 24, 0, 0).x).toBeCloseTo(76.1, 3);
    expect(sourceAt(crop, 40, 24, 39, 0).x).toBeCloseTo(122.9, 3);
    expect(sourceAt(crop, 40, 24, 20, 0).y).toBeCloseTo(88, 3);
    expect(sourceAt(crop, 40, 24, 20, 23).y).toBeCloseTo(111, 3);
  });

  it('reads the eye left to right whichever corner is the outer one', () => {
    const a = { x: 80, y: 100 };
    const b = { x: 120, y: 110 };
    expect(eyeCrop(image, b, a)).toEqual(eyeCrop(image, a, b));
  });

  it('rotates tilted eyes level', () => {
    const angle = Math.PI / 6;
    const crop = eyeCrop(image, { x: 100, y: 100 }, { x: 100 + 40 * Math.cos(angle), y: 100 + 40 * Math.sin(angle) })!;
    const first = sourceAt(crop, 40, 24, 0, 12);
    const last = sourceAt(crop, 40, 24, 39, 12);
    expect(last.x - first.x).toBeCloseTo(39 * 1.2 * Math.cos(angle), 3);
    expect(last.y - first.y).toBeCloseTo(39 * 1.2 * Math.sin(angle), 3);
  });

  it('skips eyes too small to see', () => {
    expect(eyeCrop(image, { x: 100, y: 100 }, { x: 101, y: 100 })).toBeNull();
  });
});

describe('headCrop', () => {
  it('widens the landmark box to 1.35× and extends it up 0.5× and down 0.1×, squashed to 48×48', () => {
    const points = [
      { x: 60, y: 80 },
      { x: 100, y: 120 },
      { x: 75, y: 100 },
    ];
    const crop = headCrop(coordinateImage(200, 200), points)!;
    expect(crop).toHaveLength(3 * 48 * 48);
    // Box 40×40 centered at x = 80 → source columns 53...107 and rows 60...124 (area-averaged).
    const column = (u: number) => 53 + ((u + 0.5) * 54) / 48 - 0.5;
    const row = (v: number) => 60 + ((v + 0.5) * 64) / 48 - 0.5;
    expect(sourceAt(crop, 48, 48, 0, 0)).toEqual({ x: expect.closeTo(column(0), 3), y: expect.closeTo(row(0), 3) });
    expect(sourceAt(crop, 48, 48, 47, 47)).toEqual({ x: expect.closeTo(column(47), 3), y: expect.closeTo(row(47), 3) });
  });

  it('clips the crop to the image', () => {
    const crop = headCrop(coordinateImage(100, 100), [
      { x: 0, y: 0 },
      { x: 40, y: 40 },
    ])!;
    // Columns 0...47 (not −7...47) and rows 0...44 (not −20...44), stretched to 48×48.
    expect(sourceAt(crop, 48, 48, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(sourceAt(crop, 48, 48, 47, 47)).toEqual({ x: expect.closeTo((47.5 * 47) / 48 - 0.5, 3), y: expect.closeTo((47.5 * 44) / 48 - 0.5, 3) });
  });
});

describe('cropDetail', () => {
  const width = 40;
  const height = 24;
  /** Gray CHW tensor of a fine seeded random texture over smooth shading, box-blurred by `radius` pixels. */
  function texture(radius: number, contrast = 1, brightness = 0.2): Float32Array {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sharp = Array.from({ length: width * height }, (_, i) => (0.3 * (i % width)) / width + 0.2 * random());
    const tensor = new Float32Array(3 * width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const sx = Math.min(width - 1, Math.max(0, x + dx));
            const sy = Math.min(height - 1, Math.max(0, y + dy));
            sum += sharp[sy * width + sx];
            count++;
          }
        }
        for (let c = 0; c < 3; c++) tensor[c * width * height + y * width + x] = brightness + contrast * (sum / count);
      }
    }
    return tensor;
  }

  it('drops as fine detail blurs away', () => {
    const [sharp, soft, blurred] = [0, 1, 2].map((radius) => cropDetail(texture(radius), width, height));
    expect(sharp).toBeGreaterThan(soft);
    expect(soft).toBeGreaterThan(blurred);
  });

  it('does not depend on contrast or brightness', () => {
    const reference = cropDetail(texture(1), width, height);
    expect(cropDetail(texture(1, 0.4, 0.5), width, height)).toBeCloseTo(reference, 1);
    expect(cropDetail(texture(1, 1.5, 0), width, height)).toBeCloseTo(reference, 1);
  });

  it('is 0 for a flat crop', () => {
    expect(cropDetail(new Float32Array(3 * width * height).fill(0.5), width, height)).toBe(0);
  });
});

describe('createEyeModels', () => {
  const stubNet = (inputShape: number[], output: number) => ({ inputShape, run: vi.fn(() => new Float32Array([output])) });
  /** Landmarks with only the right eye's corners set, `width` px apart. */
  const rightEye = (width: number) => {
    const points = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
    const [outer, inner] = EYE_CORNERS.right;
    points[outer] = { x: 100 - width / 2, y: 120 };
    points[inner] = { x: 100 + width / 2, y: 120 };
    return points;
  };
  const size = 240;
  let seed = 11;
  const noise = Uint8ClampedArray.from({ length: size * size * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (seed = (seed * 16807) % 2147483647) % 256,
  );
  const sharp: Pixels = { data: noise, width: size, height: size };
  const flat: Pixels = { data: new Uint8ClampedArray(size * size * 4).fill(128), width: size, height: size };

  it('runs the eye model only on eyes big and sharp enough for its reading to count', () => {
    const eyeNet = stubNet([3, 24, 40], 0.75);
    const models = createEyeModels(eyeNet as unknown as TinyNet, stubNet([3, 48, 48], 0) as unknown as TinyNet);

    expect(models.readEye(sharp, rightEye(10), 'right')).toBeNull();
    expect(models.readEye(flat, rightEye(40), 'right')).toBeNull();
    expect(eyeNet.run).not.toHaveBeenCalled();

    const reading = models.readEye(sharp, rightEye(40), 'right');
    expect(eyeNet.run).toHaveBeenCalledOnce();
    expect(reading).toMatchObject({ open: 0.75, width: 40 });
  });
});
