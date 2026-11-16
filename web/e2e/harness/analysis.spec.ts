// Browser tests of the on-device analysis engine (src/analysis) via the dev-only harness page (harness.html), on
// the fixtures described in e2e/fixtures/SOURCES.md. The assertions compare photos with each other and with the
// selection thresholds rather than pinning exact scores, so they hold in every browser and across recalibration.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { HarnessAnalyzeOptions, HarnessPhoto, HarnessResult, PhotoSortingHarness } from '../../src/analysis/harnessTypes';
import { BLURRY_THRESHOLD, nearDuplicateThreshold } from '../../src/core';

declare global {
  interface Window {
    photoSortingHarness: PhotoSortingHarness;
  }
}

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));
const FIXTURES = readdirSync(FIXTURES_DIR)
  .filter((name) => /\.(jpe?g|png)$/i.test(name))
  .sort();
const PHOTOS = FIXTURES.filter((name) => name !== 'corrupt.jpg');

const SMILES = ['a', 'b', 'c', 'd'].map((key) => `portrait-smile-${key}.jpg`);
const NEUTRALS = ['a', 'b', 'c', 'd'].map((key) => `portrait-neutral-${key}.jpg`);
const PORTRAITS = [...SMILES, ...NEUTRALS, 'portrait-astronaut.jpg'];
const SCENES = ['scene-cat.png', 'scene-coffee.jpg', 'scene-hubble.jpg', 'scene-rocket.jpg'];
const GROUPS = { 'group-crowd.jpg': 10, 'group-small-faces.jpg': 6, 'group-three.jpg': 3 };

type Pair = [string, string];
const allPairs = (names: string[]): Pair[] => names.flatMap((a, i) => names.slice(i + 1).map((b): Pair => [a, b]));
/** Re-takes of the same moment: shifted/cropped near-duplicates, and focus or exposure variants. */
const SAME_MOMENT: Pair[] = [
  ['portrait-smile-b.jpg', 'portrait-smile-b-dup.jpg'],
  ['scene-rocket.jpg', 'scene-rocket-dup.jpg'],
  ['portrait-smile-a.jpg', 'portrait-smile-a-blur-mild.jpg'],
  ['portrait-smile-a.jpg', 'portrait-smile-a-blur-strong.jpg'],
  ['scene-coffee.jpg', 'scene-coffee-blur-mild.jpg'],
  ['scene-coffee.jpg', 'scene-coffee-blur-strong.jpg'],
  ['portrait-neutral-a.jpg', 'portrait-neutral-a-under.jpg'],
  ['portrait-neutral-a.jpg', 'portrait-neutral-a-over.jpg'],
];
/** Different people in front of similar studio backdrops: the hardest case for a colour-layout descriptor. */
const DIFFERENT_PORTRAITS = allPairs(PORTRAITS);
// No scene × group pairs: group-small-faces is composited on a blurred copy of scene-coffee (see SOURCES.md).
const DIFFERENT_SCENES = [...allPairs(SCENES), ...allPairs(Object.keys(GROUPS))];

async function openHarness(page: Page, names: readonly string[]): Promise<void> {
  await page.goto('/harness.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.setInputFiles(
    '#files',
    names.map((name) => path.join(FIXTURES_DIR, name)),
  );
}

function analyze(page: Page, options: HarnessAnalyzeOptions = {}): Promise<HarnessResult> {
  return page.evaluate((opts) => window.photoSortingHarness.analyze(opts), options);
}

/** One analysis of every fixture, shared by the tests below (they only read it). */
let result: HarnessResult;
const distances = new Map<string, number>();

function photo(name: string): HarnessPhoto {
  const found = result.photos.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`${name} was not analyzed`);
  return found;
}

function distance([a, b]: Pair): number {
  const value = distances.get(`${a}|${b}`);
  if (value === undefined) throw new Error(`No distance for ${a} / ${b}`);
  return value;
}

function timingTable({ initMs, totalMs, photos }: HarnessResult): string {
  const ms = (value: number) => value.toFixed(0).padStart(6);
  const rows = photos.map(({ name, width, height, faces, detector, timings: t }) =>
    [
      name.padEnd(34),
      `${width}×${height}`.padEnd(10),
      ms(t.total),
      ms(t.decode),
      ms(t.resize),
      ms(t.metrics),
      ms(t.faces),
      String(detector.calls).padStart(6),
      ms(t.faceMetrics),
      ms(t.finish),
      String(faces.length).padStart(6),
    ].join(' '),
  );
  const header = `${'photo'.padEnd(34)} ${'size'.padEnd(10)}  total decode resize metric  faces  calls fmetric finish #faces`;
  const mean = photos.reduce((sum, { timings }) => sum + timings.total, 0) / photos.length;
  return [header, ...rows, `init ${initMs.toFixed(0)} ms · ${photos.length} photos in ${totalMs.toFixed(0)} ms · mean ${mean.toFixed(0)} ms/photo`].join('\n');
}

test.beforeAll(async ({ browser }, testInfo) => {
  const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
  try {
    await openHarness(page, FIXTURES);
    result = await analyze(page);
    console.log(`\n[${testInfo.project.name}] per-photo analysis time (ms)\n${timingTable(result)}`);
    const pairs = [...SAME_MOMENT, ...DIFFERENT_PORTRAITS, ...DIFFERENT_SCENES];
    const values = await page.evaluate((list) => list.map(([a, b]) => window.photoSortingHarness.distance(a, b)), pairs);
    pairs.forEach(([a, b], i) => distances.set(`${a}|${b}`, values[i]));
  } finally {
    await page.close();
  }
});

test('analyzes every photo; an undecodable file becomes a failure instead of a crash', () => {
  expect(result.cancelled).toBe(false);
  expect(result.progressEvents).toBe(FIXTURES.length);
  expect(result.photos.map(({ name }) => name).sort()).toEqual(PHOTOS);
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0]).toMatchObject({ name: 'corrupt.jpg', reason: "This image format can't be opened in this browser" });
  expect(result.failures[0].key).toMatch(/^corrupt\.jpg\|\d+\|\d+$/);
  for (const { name, timings } of result.photos) expect(timings.total, name).toBeLessThan(10_000);
});

test('reports upright EXIF-oriented sizes and EXIF capture times', () => {
  const rotated = photo('portrait-rotated-exif6.jpg');
  expect([rotated.width, rotated.height]).toEqual([450, 550]);
  expect(rotated.faces).toHaveLength(1);

  // Shoot timeline: 2025-06-14 14:00 at UTC−4 (see SOURCES.md).
  expect(photo('portrait-smile-a.jpg').capturedAt).toBe(Date.UTC(2025, 5, 14, 18, 2, 10));
  const gap = (a: string, b: string) => photo(b).capturedAt! - photo(a).capturedAt!;
  expect(gap('portrait-smile-b.jpg', 'portrait-smile-b-dup.jpg')).toBe(2_000);
  expect(gap('scene-rocket.jpg', 'scene-rocket-dup.jpg')).toBe(3_000);
  expect(photo('scene-hubble.jpg').capturedAt).toBeNull();
  expect(photo('scene-cat.png').capturedAt).toBeNull();
  const dated = PHOTOS.filter((name) => name.endsWith('.jpg') && name !== 'scene-hubble.jpg');
  for (const name of dated) expect(photo(name).capturedAt, name).not.toBeNull();
});

test('makes small upright thumbnails; nothing is flagged as a screenshot', () => {
  for (const { name, width, height, thumbnail, isUtility } of result.photos) {
    expect(Math.max(thumbnail.width, thumbnail.height), name).toBeLessThanOrEqual(400);
    expect(thumbnail.width / thumbnail.height, name).toBeCloseTo(width / height, 1);
    expect(isUtility, name).toBe(false);
  }
});

test('scores toothy smiles clearly above neutral expressions', () => {
  const smileOf = (name: string) => {
    const { faces } = photo(name);
    expect(faces, name).toHaveLength(1);
    return faces[0].smile;
  };
  const smiles = SMILES.map(smileOf);
  const neutrals = NEUTRALS.map(smileOf);
  for (const value of smiles) expect(value).toBeGreaterThanOrEqual(0.45);
  for (const value of neutrals) expect(value).toBeLessThanOrEqual(0.25);
  expect(Math.min(...smiles) - Math.max(...neutrals)).toBeGreaterThanOrEqual(0.25);
});

test('sees open eyes on every face', () => {
  for (const { name, faces } of result.photos) {
    for (const face of faces) expect(face.eyesOpen, name).toBeGreaterThan(0.7);
  }
});

test('finds every face in group photos, one per portrait and none in scenery', () => {
  for (const { name, faces } of result.photos) {
    const expected = name in GROUPS ? GROUPS[name as keyof typeof GROUPS] : name.startsWith('scene-') ? 0 : 1;
    expect(faces.length, name).toBe(expected);
  }
  // The crowd's faces are 2.7–3.8% of the image width.
  const crowd = photo('group-crowd.jpg').faces.map(({ box }) => box.width);
  expect(Math.min(...crowd)).toBeLessThanOrEqual(0.03);
  expect(Math.max(...crowd)).toBeLessThan(0.045);
});

test('measures blur and still counts a sharp face on a soft background as sharp', () => {
  for (const base of ['portrait-smile-a', 'scene-coffee']) {
    const original = photo(`${base}.jpg`).sharpness;
    const mild = photo(`${base}-blur-mild.jpg`).sharpness;
    const strong = photo(`${base}-blur-strong.jpg`).sharpness;
    expect(mild, base).toBeLessThan(original / 2);
    expect(strong, base).toBeLessThan(mild);
    expect(strong, base).toBeLessThan(BLURRY_THRESHOLD);
  }
  expect(photo('portrait-smile-a.jpg').sharpness).toBeGreaterThan(BLURRY_THRESHOLD);

  const faceQuality = (name: string) => photo(name).faces[0].captureQuality!;
  expect(faceQuality('portrait-smile-a-blur-mild.jpg')).toBeLessThan(faceQuality('portrait-smile-a.jpg'));
  expect(faceQuality('portrait-smile-a-blur-strong.jpg')).toBeLessThan(faceQuality('portrait-smile-a-blur-mild.jpg'));

  const bokeh = photo('portrait-bokeh.jpg');
  expect(bokeh.faceRegionSharpness).not.toBeNull();
  expect(bokeh.faceRegionSharpness!).toBeGreaterThan(bokeh.wholeSharpness);
  expect(bokeh.sharpness).toBeGreaterThan(BLURRY_THRESHOLD);
});

test('scores under- and over-exposed variants well below the original', () => {
  const original = photo('portrait-neutral-a.jpg').exposure;
  expect(original).toBeGreaterThan(0.8);
  expect(photo('portrait-neutral-a-under.jpg').exposure).toBeLessThan(original - 0.3);
  expect(photo('portrait-neutral-a-over.jpg').exposure).toBeLessThan(original - 0.3);
});

test('separates re-takes of the same moment from different photos', () => {
  for (const pair of SAME_MOMENT) expect(distance(pair), pair.join(' / ')).toBeLessThanOrEqual(nearDuplicateThreshold(0.5));
  for (const pair of DIFFERENT_PORTRAITS) expect(distance(pair), pair.join(' / ')).toBeGreaterThan(nearDuplicateThreshold(0.5));
  for (const pair of DIFFERENT_SCENES) expect(distance(pair), pair.join(' / ')).toBeGreaterThan(nearDuplicateThreshold(1));
});

test('creates upright previews no larger than requested', async ({ page }) => {
  await openHarness(page, ['group-crowd.jpg', 'portrait-rotated-exif6.jpg', 'scene-cat.png']);
  const preview = (name: string, maxEdge?: number) =>
    page.evaluate(([file, edge]) => window.photoSortingHarness.preview(file, edge), [name, maxEdge] as const);
  expect(await preview('group-crowd.jpg')).toEqual({ width: 1600, height: 1067 });
  const small = await preview('group-crowd.jpg', 800);
  expect(small.width).toBe(800);
  expect(Math.abs(small.height - 533.5)).toBeLessThanOrEqual(1);
  expect(await preview('portrait-rotated-exif6.jpg', 275)).toEqual({ width: 225, height: 275 });
  expect(await preview('scene-cat.png')).toEqual({ width: 451, height: 300 });
});

test('stops after the current photo when cancelled', async ({ page }) => {
  await openHarness(page, PORTRAITS);
  const cancelled = await analyze(page, { cancelAfter: 2 });
  expect(cancelled.cancelled).toBe(true);
  expect(cancelled.progressEvents).toBe(2);
  expect(cancelled.photos.map(({ name }) => name)).toEqual(PORTRAITS.slice(0, 2));
  expect(cancelled.failures).toEqual([]);
});

test('reports an engine load failure in plain words and loads on retry', async ({ page }) => {
  await page.route('**/face_landmarker.task', (route) => route.abort());
  await openHarness(page, ['portrait-smile-a.jpg']);
  await expect(analyze(page)).rejects.toThrow("Couldn't load the photo analysis engine. Check your connection and try again.");
  await page.unrouteAll();
  const retried = await analyze(page);
  expect(retried.photos).toHaveLength(1);
  expect(retried.photos[0].faces).toHaveLength(1);
});
