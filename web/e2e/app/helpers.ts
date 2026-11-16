import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, truncateSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));
/** The fixture photos (see e2e/fixtures/SOURCES.md), including corrupt.jpg, which can't be decoded. */
export const FIXTURE_NAMES = readdirSync(FIXTURES_DIR)
  .filter((name) => /\.(jpe?g|png)$/i.test(name))
  .sort();
export const FIXTURE_PATHS = FIXTURE_NAMES.map((name) => path.join(FIXTURES_DIR, name));
export const FIXTURE_COUNT = FIXTURE_NAMES.length;

export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** `copies` renamed copies of every fixture, for runs that should take a while. */
export function fixtureCopies(copies: number): FilePayload[] {
  const payloads: FilePayload[] = [];
  for (let copy = 1; copy <= copies; copy++) {
    for (const name of FIXTURE_NAMES) {
      const extension = path.extname(name);
      payloads.push({
        name: `${path.basename(name, extension)}-copy${copy}${extension}`,
        mimeType: extension === '.png' ? 'image/png' : 'image/jpeg',
        buffer: readFileSync(path.join(FIXTURES_DIR, name)),
      });
    }
  }
  return payloads;
}

const BIG_PHOTO_SOURCES = [
  'portrait-smile-a.jpg',
  'portrait-neutral-b.jpg',
  'portrait-smile-c.jpg',
  'group-three.jpg',
  'scene-rocket.jpg',
  'scene-coffee.jpg',
];

/**
 * Writes copies of six distinct, sharp fixtures to `dir`, each about 47 MB big: 45 MB of zero bytes follow the end of
 * the JPEG data, which decoders ignore. Together they're too big for one ZIP file. Returns their paths (pass paths, not
 * buffers, to setInputFiles: Playwright doesn't send buffers over 50 MB).
 */
export function writeBigPhotos(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  return BIG_PHOTO_SOURCES.map((name) => {
    const source = path.join(FIXTURES_DIR, name);
    const target = path.join(dir, name);
    copyFileSync(source, target);
    // Making a file longer fills the new part with zero bytes.
    truncateSync(target, statSync(source).size + 45 * 1024 * 1024);
    return target;
  });
}

export const RESULTS_TIMEOUT = 150_000;

export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-screen="setup"]')).toBeVisible();
}

export async function choosePhotos(page: Page, files: string[] | FilePayload[]): Promise<void> {
  await page.getByTestId('photo-input').setInputFiles(files);
  await expect(page.getByTestId('photo-count')).toHaveText(`${files.length} photos selected`);
}

export function stepperInput(page: Page, label: string): Locator {
  return page.getByRole('spinbutton', { name: label, exact: true });
}

/** Types a number into a stepper, like tapping the number and using the keypad. */
export async function setStepper(page: Page, label: string, value: number): Promise<void> {
  const input = stepperInput(page, label);
  await input.fill(String(value));
  await input.press('Enter');
  await expect(input).toHaveValue(String(value));
}

export function categorySwitch(page: Page, name: string): Locator {
  return page.getByRole('switch', { name, exact: true });
}

/** Moves a category to the top of the priority order (in Edit Order mode). */
export async function moveToTop(page: Page, name: string): Promise<void> {
  const moveUp = page.getByRole('button', { name: `Move ${name} up` });
  while ((await moveUp.getAttribute('aria-disabled')) !== 'true') await moveUp.click();
}

/**
 * A plan whose result is predictable with the fixtures: 10 photos — Group Shots 1 (moved to the top so Best Smiles
 * can't take the group photos first), Best Smiles 3, Portraits 2, Scenery & Details 2, and 2 more filled with Best
 * Overall.
 */
export async function applyTestPlan(page: Page): Promise<void> {
  await setStepper(page, 'Total photos', 10);
  await page.getByRole('button', { name: 'Edit Order' }).click();
  await moveToTop(page, 'Group Shots');
  await page.getByRole('button', { name: 'Done' }).click();
  await setStepper(page, 'Group Shots photos', 1);
  await setStepper(page, 'Best Smiles photos', 3);
  await setStepper(page, 'Portraits photos', 2);
  await categorySwitch(page, 'Scenery & Details').click();
  await setStepper(page, 'Scenery & Details photos', 2);
  await expect(page.getByTestId('assignment-summary')).toHaveText('8 of 10 assigned · 2 filled with Best Overall');
}

/** A plan that picks all `total` photos: no categories, every photo filled with Best Overall, duplicates and blur allowed. */
export async function applyPickAllPlan(page: Page, total: number): Promise<void> {
  await setStepper(page, 'Total photos', total);
  for (const name of ['Best Smiles', 'Group Shots', 'Portraits', 'Avoid near-duplicates', 'Skip blurry photos']) {
    await categorySwitch(page, name).click();
  }
  await expect(page.getByTestId('assignment-summary')).toHaveText(`0 of ${total} assigned · ${total} filled with Best Overall`);
}

export async function findBestPhotos(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Find Best Photos' }).click();
  await expect(page.locator('[data-screen="results"]')).toBeVisible({ timeout: RESULTS_TIMEOUT });
}

/** Opens the app, chooses all fixtures, applies the test plan and waits for the results. */
export async function analyzeWithTestPlan(page: Page): Promise<void> {
  await openApp(page);
  await choosePhotos(page, FIXTURE_PATHS);
  await applyTestPlan(page);
  await findBestPhotos(page);
}

export function resultSection(page: Page, key: string): Locator {
  return page.locator(`[data-section="${key}"]`);
}

/** File names of the photos shown in a results section (or all sections), optionally only the kept ones. */
export function tileNames(scope: Locator, { keptOnly = false } = {}): Promise<string[]> {
  const tiles = scope.locator(keptOnly ? 'li.photo-tile:not([data-removed])' : 'li.photo-tile');
  return tiles.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-name') ?? ''));
}

export function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Save (\d+ Photos?|Photos)$/ });
}

export function toast(page: Page): Locator {
  return page.locator('.toast-region');
}

/** Replaces the Web Share API with a recorder whose outcome the test controls (window.__shareMode). */
export async function stubShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Recorded = { names: string[]; sizes: number[]; types: string[] };
    const state = window as unknown as {
      __shares: Recorded[];
      __shareMode: 'hold' | 'abort' | 'fail';
      __finishShare?: () => void;
    };
    state.__shares = [];
    state.__shareMode = 'hold';
    Object.defineProperty(Navigator.prototype, 'canShare', {
      configurable: true,
      value: (data?: ShareData) => Boolean(data?.files && data.files.length > 0),
    });
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: (data: ShareData) => {
        const files = data.files ?? [];
        state.__shares.push({ names: files.map((f) => f.name), sizes: files.map((f) => f.size), types: files.map((f) => f.type) });
        if (state.__shareMode === 'abort') return Promise.reject(new DOMException('Share canceled', 'AbortError'));
        if (state.__shareMode === 'fail') return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
        return new Promise<void>((resolve) => {
          state.__finishShare = resolve;
        });
      },
    });
  });
}

/** Removes the Web Share API, like a browser that can't share files. */
export async function removeShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const name of ['share', 'canShare']) {
      Object.defineProperty(Navigator.prototype, name, { configurable: true, value: undefined });
    }
  });
}

/** Replaces navigator.clipboard with a recorder (window.__copied). */
export async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as unknown as { __copied: string[] };
    state.__copied = [];
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      get: () => ({
        writeText: (text: string) => {
          state.__copied.push(text);
          return Promise.resolve();
        },
      }),
    });
  });
}

/** Records (in window.__sawAnalyzing) whether the analyzing screen is ever shown from now on. */
export async function watchForAnalyzingScreen(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as { __sawAnalyzing: boolean };
    state.__sawAnalyzing = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-screen="analyzing"]')) state.__sawAnalyzing = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
}
