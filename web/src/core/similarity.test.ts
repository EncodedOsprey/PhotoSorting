import { describe, expect, it } from 'vitest';
import {
  computeDescriptor,
  createNearDuplicateChecker,
  descriptorDistance,
  DESCRIPTOR_GRID,
  nearDuplicateThreshold,
} from './similarity';
import type { SimilarityItem } from './types';

// MARK: - Synthetic photos

type RGB = readonly [number, number, number];

interface Shape {
  round: boolean;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  color: RGB;
}

interface Wave {
  fx: number;
  fy: number;
  phase: number;
  amplitude: RGB;
}

/** A procedural scene in normalized coordinates (0...1 across the frame), so any framing can be rendered. */
interface Scene {
  base: RGB;
  /** Top-to-bottom colour gradient (sky/wall to ground). */
  tilt: RGB;
  waves: Wave[];
  /** Painted in order, later shapes on top. */
  shapes: Shape[];
}

interface Camera {
  /** Shift of the framing, as a fraction of the frame width / height. */
  dx?: number;
  dy?: number;
  /** > 1 zooms in about the centre. */
  zoom?: number;
  gain?: number;
  contrast?: number;
  noiseSeed?: number;
}

const WIDTH = 320;
const HEIGHT = 240;

/** Mulberry32: small seeded PRNG returning 0...1. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTools(seed: number) {
  const random = prng(seed);
  const between = (low: number, high: number) => low + (high - low) * random();
  const color = (low = 30, high = 220): RGB => [between(low, high), between(low, high), between(low, high)];
  return { random, between, color };
}

/** Smooth gradient + low-frequency waves + three large objects and four small details. */
function randomBackdrop(seed: number): Scene {
  const { random, between, color } = randomTools(seed);
  const waves = Array.from({ length: 5 }, (_, k): Wave => {
    const frequency = 0.5 + 0.6 * k;
    const angle = between(0, 2 * Math.PI);
    const amplitude = 40 / (1 + k);
    return {
      fx: frequency * Math.cos(angle),
      fy: frequency * Math.sin(angle),
      phase: between(0, 2 * Math.PI),
      amplitude: [between(-1, 1) * amplitude, between(-1, 1) * amplitude, between(-1, 1) * amplitude],
    };
  });
  const shape = (minRadius: number, maxRadius: number): Shape => ({
    round: random() < 0.5,
    cx: between(-0.05, 1.05),
    cy: between(-0.05, 1.05),
    rx: between(minRadius, maxRadius),
    ry: between(minRadius, maxRadius),
    color: color(),
  });
  const large = Array.from({ length: 3 }, () => shape(0.1, 0.25));
  const small = Array.from({ length: 4 }, () => shape(0.02, 0.06));
  return { base: color(70, 170), tilt: [between(-60, 60), between(-60, 60), between(-60, 60)], waves, shapes: [...large, ...small] };
}

interface Person {
  x: number;
  scale: number;
  shirt: RGB;
  skin: RGB;
  bodyWidth?: number;
  headShift?: readonly [number, number];
}

/** Body (ellipse rising from the bottom edge) and head. Scale 1.2 covers ~17% of the frame, 1.5 ~26%. */
function personShapes({ x, scale, shirt, skin, bodyWidth = 1, headShift = [0, 0] }: Person): Shape[] {
  const bodyRy = 0.3 * scale;
  const bodyCy = 1.02 - 0.5 * bodyRy;
  const headRy = 0.1 * scale;
  return [
    { round: true, cx: x, cy: bodyCy, rx: 0.13 * scale * bodyWidth, ry: bodyRy, color: shirt },
    {
      round: true,
      cx: x + headShift[0],
      cy: bodyCy - bodyRy - 0.6 * headRy + headShift[1],
      rx: 0.075 * scale,
      ry: headRy,
      color: skin,
    },
  ];
}

const withShapes = (scene: Scene, shapes: Shape[]): Scene => ({ ...scene, shapes: [...scene.shapes, ...shapes] });

/** Renders RGBA bytes with mild sensor noise; gain/contrast are applied like an exposure change and clip. */
function render(scene: Scene, camera: Camera = {}, width = WIDTH, height = HEIGHT): Uint8ClampedArray {
  const { dx = 0, dy = 0, zoom = 1, gain = 1, contrast = 1, noiseSeed = 1 } = camera;
  const us = Float64Array.from({ length: width }, (_, x) => 0.5 + ((x + 0.5) / width - 0.5) / zoom + dx);
  const vs = Float64Array.from({ length: height }, (_, y) => 0.5 + ((y + 0.5) / height - 0.5) / zoom + dy);
  const rgb = new Float64Array(width * height * 3);

  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p += 3) {
      for (let c = 0; c < 3; c++) rgb[p + c] = scene.base[c] + scene.tilt[c] * (vs[y] - 0.5);
    }
  }
  for (const { fx, fy, phase, amplitude } of scene.waves) {
    // cos(a + b) = cos a cos b − sin a sin b keeps this separable (fast).
    const cosU = us.map((u) => Math.cos(2 * Math.PI * fx * u));
    const sinU = us.map((u) => Math.sin(2 * Math.PI * fx * u));
    const cosV = vs.map((v) => Math.cos(2 * Math.PI * fy * v + phase));
    const sinV = vs.map((v) => Math.sin(2 * Math.PI * fy * v + phase));
    for (let y = 0, p = 0; y < height; y++) {
      for (let x = 0; x < width; x++, p += 3) {
        const s = cosU[x] * cosV[y] - sinU[x] * sinV[y];
        for (let c = 0; c < 3; c++) rgb[p + c] += amplitude[c] * s;
      }
    }
  }
  for (const { round, cx, cy, rx, ry, color } of scene.shapes) {
    for (let y = 0; y < height; y++) {
      const ay = (vs[y] - cy) / ry;
      if (Math.abs(ay) > 1) continue;
      for (let x = 0; x < width; x++) {
        const ax = (us[x] - cx) / rx;
        if (round ? ax * ax + ay * ay > 1 : Math.abs(ax) > 1) continue;
        rgb.set(color, (y * width + x) * 3);
      }
    }
  }

  const noise = prng(noiseSeed);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
    for (let c = 0; c < 3; c++) {
      rgba[p + c] = Math.round(((rgb[i + c] + 6 * (noise() - 0.5) - 128) * contrast + 128) * gain);
    }
    rgba[p + 3] = 255;
  }
  return rgba;
}

const descriptorOf = (scene: Scene, camera?: Camera) => computeDescriptor(render(scene, camera), WIDTH, HEIGHT);

/** One synthetic shoot: a person in front of a random backdrop, plus variations of it. */
function makeShoot(seed: number) {
  const { between, color } = randomTools(seed * 31 + 5);
  const backdrop = randomBackdrop(seed);
  const person: Person = {
    x: between(0.3, 0.7),
    scale: 1.2,
    shirt: color(),
    skin: [between(150, 220), between(110, 170), between(90, 140)],
  };
  // ~26% and ~35% of the frame: different position, clothing colour, build and skin tone.
  const subjectA: Person = { x: between(0.25, 0.4), scale: 1.5, shirt: color(), skin: [200, 150, 120] };
  const subjectB: Person = {
    x: subjectA.x + 0.3,
    scale: 1.5,
    bodyWidth: 1.4,
    shirt: [255 - subjectA.shirt[0], 255 - subjectA.shirt[1], 255 - subjectA.shirt[2]],
    skin: [120, 80, 60],
  };
  const newObject: Shape = { round: true, cx: between(0.15, 0.85), cy: between(0.15, 0.85), rx: 0.15, ry: 0.15, color: color() };
  return {
    scene: withShapes(backdrop, personShapes(person)),
    /** The head turns and moves (~3% of the frame changes). */
    headMoved: withShapes(backdrop, personShapes({ ...person, headShift: [0.07, 0.02], skin: [90, 60, 40] })),
    /** Something covering ~7% of the frame appears. */
    newObject: withShapes(backdrop, [...personShapes(person), newObject]),
    subjectA: withShapes(backdrop, personShapes(subjectA)),
    subjectB: withShapes(backdrop, personShapes(subjectB)),
  };
}

const SEEDS = [101, 108, 115, 122, 129, 136, 143, 150];
const shoots = SEEDS.map(makeShoot);
const references = shoots.map((shoot) => descriptorOf(shoot.scene));

/** Distances from each shoot's reference frame to a re-shot frame (fresh sensor noise). */
const distancesTo = (variant: (shoot: ReturnType<typeof makeShoot>) => [Scene, Camera]) =>
  shoots.map((shoot, i) => {
    const [scene, camera] = variant(shoot);
    return descriptorDistance(references[i], descriptorOf(scene, { noiseSeed: 2, ...camera }));
  });

// MARK: - Tests

describe('computeDescriptor', () => {
  it('area-averages with fractional pixel coverage', () => {
    // 3 pixels across 16 columns: pixel edges at 16/3 and 32/3 columns, so columns 5 and 10 straddle two pixels.
    const rgba = [0, 0, 0, 255, 90, 90, 90, 255, 180, 180, 180, 255];
    const row = [0, 0, 0, 0, 0, 60, 90, 90, 90, 90, 120, 180, 180, 180, 180, 180];
    const expected = standardized(Array.from({ length: DESCRIPTOR_GRID }, () => row.flatMap((v) => [v, v, v])).flat());

    const descriptor = computeDescriptor(rgba, 3, 1);
    expect(descriptor).toHaveLength(DESCRIPTOR_GRID * DESCRIPTOR_GRID * 3);
    descriptor.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));
  });

  it('handles images smaller than the grid', () => {
    const tiny = Array.from({ length: 7 * 5 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
    const descriptor = computeDescriptor(tiny, 7, 5);
    const mean = descriptor.reduce((sum, v) => sum + v, 0) / descriptor.length;
    const variance = descriptor.reduce((sum, v) => sum + (v - mean) ** 2, 0) / descriptor.length;
    expect(mean).toBeCloseTo(0, 5);
    expect(variance).toBeCloseTo(1, 4);
    // Area averaging is resolution independent: the same picture at 3× (nearest-neighbour) gives the same descriptor.
    expect(descriptorDistance(descriptor, computeDescriptor(upscale(tiny, 7, 5, 3), 21, 15))).toBeLessThan(1e-6);

    const onePixel = computeDescriptor([200, 120, 40, 255], 1, 1);
    const flatColour = computeDescriptor(render({ base: [200, 120, 40], tilt: [0, 0, 0], waves: [], shapes: [] }, { noiseSeed: 0 }, 8, 6), 8, 6);
    expect(onePixel.every((v) => Number.isFinite(v))).toBe(true);
    expect(descriptorDistance(onePixel, flatColour)).toBeLessThan(0.01);
  });

  it('returns all zeros for a flat gray image and rejects bad input', () => {
    expect(computeDescriptor(new Uint8Array(10 * 10 * 4).fill(77), 10, 10).every((v) => v === 0)).toBe(true);
    expect(() => computeDescriptor(new Uint8Array(4 * 4 * 4 - 1), 4, 4)).toThrow(RangeError);
    expect(() => computeDescriptor(new Uint8Array(0), 0, 0)).toThrow(RangeError);
  });
});

describe('descriptorDistance', () => {
  const pattern = Float32Array.from({ length: 768 }, (_, i) => (i % 3 === 0 ? Math.SQRT2 : -Math.SQRT1_2));
  const flat = new Float32Array(768);

  it('is 0 for identical, 0.5 for unrelated and 1 for inverted descriptors', () => {
    const unrelated = Float32Array.from(pattern, (_, i) => (Math.floor(i / 3) % 2 === 0 ? pattern[i] : -pattern[i]));
    expect(descriptorDistance(pattern, Float32Array.from(pattern))).toBeCloseTo(0, 6);
    expect(descriptorDistance(pattern, unrelated)).toBeCloseTo(0.5, 2);
    expect(descriptorDistance(pattern, Float32Array.from(pattern, (v) => -v))).toBeCloseTo(1, 6);
  });

  it('treats flat images as identical to each other only', () => {
    expect(descriptorDistance(flat, new Float32Array(768))).toBe(0);
    expect(descriptorDistance(flat, pattern)).toBe(1);
    expect(descriptorDistance(pattern, flat)).toBe(1);
  });

  it('rejects descriptors of different lengths', () => {
    expect(() => descriptorDistance(pattern, new Float32Array(10))).toThrow(RangeError);
  });
});

describe('nearDuplicateThreshold', () => {
  it('interpolates from strict to loose, clamping looseness', () => {
    const strict = nearDuplicateThreshold(0);
    const loose = nearDuplicateThreshold(1);
    expect(strict).toBeLessThan(loose);
    expect(nearDuplicateThreshold(0.5)).toBeCloseTo((strict + loose) / 2, 10);
    expect(nearDuplicateThreshold(-3)).toBe(strict);
    expect(nearDuplicateThreshold(7)).toBe(loose);
    expect(nearDuplicateThreshold(Number.NaN)).toBe(nearDuplicateThreshold(0.5));
  });
});

describe('near-duplicate calibration on synthetic photos', () => {
  const strict = nearDuplicateThreshold(0);
  const standard = nearDuplicateThreshold(0.5);
  const loose = nearDuplicateThreshold(1);

  it('ignores exposure and contrast changes (bracketing)', () => {
    const variants: Camera[] = [{ gain: 0.8 }, { gain: 1.2 }, { contrast: 0.7 }, { contrast: 1.3 }];
    for (const camera of variants) {
      for (const distance of distancesTo((shoot) => [shoot.scene, camera])) {
        expect(distance).toBeLessThan(0.002);
        expect(distance).toBeLessThanOrEqual(strict);
      }
    }
  });

  it('treats a 2% camera shift as a duplicate even at looseness 0', () => {
    for (const camera of [{ dx: 0.02 }, { dy: 0.02 }]) {
      for (const distance of distancesTo((shoot) => [shoot.scene, camera])) expect(distance).toBeLessThanOrEqual(strict);
    }
  });

  it('treats a 5% shift or a small changed region as a duplicate at the default looseness', () => {
    const variants = [
      distancesTo((shoot) => [shoot.scene, { dx: 0.05 }]),
      distancesTo((shoot) => [shoot.headMoved, {}]),
      distancesTo((shoot) => [shoot.newObject, {}]),
    ];
    for (const distance of variants.flat()) expect(distance).toBeLessThanOrEqual(standard);
  });

  it('treats a 10% zoom as a duplicate at looseness 1', () => {
    for (const distance of distancesTo((shoot) => [shoot.scene, { zoom: 1.1 }])) {
      expect(distance).toBeLessThanOrEqual(loose);
    }
  });

  it('never treats different scenes as duplicates, with a margin', () => {
    for (let i = 0; i < references.length; i++) {
      for (let j = i + 1; j < references.length; j++) {
        expect(descriptorDistance(references[i], references[j])).toBeGreaterThan(1.25 * loose);
      }
    }
  });

  it('does not treat the same backdrop with a different subject as a duplicate at the default looseness', () => {
    for (const shoot of shoots) {
      expect(descriptorDistance(descriptorOf(shoot.subjectA), descriptorOf(shoot.subjectB))).toBeGreaterThan(standard);
    }
  });
});

describe('createNearDuplicateChecker', () => {
  const look = Float32Array.from({ length: 768 }, (_, i) => (i % 2 === 0 ? 1 : -1));
  const otherLook = Float32Array.from(look, (v) => -v);

  const item = (id: string, overrides: Partial<SimilarityItem<string>> = {}): SimilarityItem<string> => ({
    id,
    capturedAt: 0,
    order: 0,
    aspect: 4 / 3,
    descriptor: Float32Array.from(look),
    ...overrides,
  });

  it('matches identical ids and never unknown ones', () => {
    const isDuplicate = createNearDuplicateChecker([item('a'), item('b', { descriptor: otherLook })], 0.1);
    expect(isDuplicate('a', 'a')).toBe(true);
    expect(isDuplicate('a', 'b')).toBe(false);
    expect(isDuplicate('a', 'missing')).toBe(false);
  });

  it('only matches photos taken within the time window', () => {
    const items = [
      item('a', { capturedAt: 0, order: 0 }),
      item('b', { capturedAt: 180_000, order: 100 }),
      item('c', { capturedAt: 180_001, order: 1 }),
    ];
    const isDuplicate = createNearDuplicateChecker(items, 0.1);
    expect(isDuplicate('a', 'b')).toBe(true);
    expect(isDuplicate('a', 'c')).toBe(false);
    expect(isDuplicate('b', 'c')).toBe(true);
    expect(createNearDuplicateChecker(items, 0.1, { maxSeconds: 60 })('a', 'b')).toBe(false);
  });

  it('falls back to the order window when a capture time is unknown', () => {
    const items = [
      item('a', { capturedAt: null, order: 0 }),
      item('b', { capturedAt: 5_000, order: 30 }),
      item('c', { capturedAt: Number.NaN, order: 31 }),
    ];
    const isDuplicate = createNearDuplicateChecker(items, 0.1);
    expect(isDuplicate('a', 'b')).toBe(true);
    expect(isDuplicate('a', 'c')).toBe(false);
    expect(createNearDuplicateChecker(items, 0.1, { maxOrderGap: 31 })('a', 'c')).toBe(true);
  });

  it('never matches differently framed photos', () => {
    const items = [item('landscape'), item('portrait', { aspect: 3 / 4 }), item('wider', { aspect: 1.5 })];
    const isDuplicate = createNearDuplicateChecker(items, 0.1);
    expect(isDuplicate('landscape', 'portrait')).toBe(false);
    expect(isDuplicate('landscape', 'wider')).toBe(true);
  });

  it('compares descriptors against the threshold symmetrically, caching each pair', () => {
    const a = item('a');
    const b = item('b');
    const isDuplicate = createNearDuplicateChecker([a, b, item('c', { descriptor: otherLook })], 0.1);
    expect(isDuplicate('a', 'b')).toBe(true);
    expect(isDuplicate('a', 'c')).toBe(false);
    expect(isDuplicate('c', 'a')).toBe(false);

    b.descriptor.set(otherLook);
    expect(isDuplicate('b', 'a')).toBe(true);
    expect(createNearDuplicateChecker([a, b], 0.1)('b', 'a')).toBe(false);
  });
});

// MARK: - Helpers

function standardized(values: number[]): number[] {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  return values.map((v) => (v - mean) / std);
}

function upscale(rgba: ArrayLike<number>, width: number, height: number, factor: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * factor * height * factor * 4);
  for (let y = 0; y < height * factor; y++) {
    for (let x = 0; x < width * factor; x++) {
      const source = (Math.floor(y / factor) * width + Math.floor(x / factor)) * 4;
      for (let c = 0; c < 4; c++) out[(y * width * factor + x) * 4 + c] = rgba[source + c];
    }
  }
  return out;
}
