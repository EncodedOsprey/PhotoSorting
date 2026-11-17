import { rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  FIXTURE_PATHS,
  RESULTS_TIMEOUT,
  applyPickAllPlan,
  categorySwitch,
  choosePhotos,
  findBestPhotos,
  fixtureCopies,
  openApp,
  removeShare,
  saveButton,
  setStepper,
  stubShare,
  writeBigPhotos,
} from './helpers';

/*
 * Screenshots of every screen for visual review, saved to test-results/screenshots/: light and dark mode at iPhone 15
 * size, plus a 320-point-wide screen (iPhone SE, 1st generation). Every screenshot also checks that nothing on the
 * screen is wider than the screen.
 */

test.skip(({ browserName }) => browserName !== 'webkit', 'Screenshots are taken on the iPhone (WebKit) project.');
// Lets page.route hold back the analysis engine's download.
test.use({ serviceWorkers: 'block' });

const MODEL_URL = '**/mediapipe/face_landmarker.task';

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Wait until the photos on screen have loaded and the navigation bar has caught up with the scroll position.
  await page.waitForFunction(() => {
    const loaded = [...document.images].every((image) => {
      const box = image.getBoundingClientRect();
      return image.complete || box.bottom < 0 || box.top > window.innerHeight;
    });
    const bar = document.querySelector('.navbar');
    const title = document.querySelector('.hero__title');
    const scrolledPast = !!bar && !!title && title.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom + 1;
    return loaded && (!bar || bar.classList.contains('navbar--scrolled') === scrolledPast);
  });
  const tooWide = await page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], .sheet__body')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
  );
  expect(tooWide, `${name}: wider than the screen`).toEqual([]);
  await page.screenshot({
    path: path.join(testInfo.project.outputDir, 'screenshots', `${name}.png`),
    animations: 'disabled',
  });
}

/** Scrolls the page so that `target` sits just below the compact title bar. */
async function scrollPageTo(target: Locator): Promise<void> {
  await target.evaluate((element) => {
    window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 64, behavior: 'instant' });
  });
  await target.page().waitForTimeout(300);
}

async function scrollPageToEnd(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(300);
}

async function scrollSheet(page: Page, to: 'scores' | 'end'): Promise<void> {
  await page.locator('.sheet__body').evaluate((body, where) => {
    const scores = body.querySelector('#detail-scores');
    const top =
      where === 'end' || !scores
        ? body.scrollHeight
        : scores.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 12;
    body.scrollTo({ top, behavior: 'instant' });
  }, to);
  await page.waitForTimeout(300);
}

async function openFirstPick(page: Page): Promise<Locator> {
  await page.locator('li.photo-tile button').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect
    .poll(() => page.getByTestId('detail-preview').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  return sheet;
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme });
    const shot = (page: Page, testInfo: TestInfo, name: string) => capture(page, testInfo, `${name}-${colorScheme}`);

    test('setup screen', async ({ page }, testInfo) => {
      await openApp(page);
      await shot(page, testInfo, 'setup-1-empty');

      await page.getByText('Finding your shoot').click();
      await scrollPageTo(page.getByRole('region', { name: 'Photos' }));
      await shot(page, testInfo, 'setup-2-help');
      await page.getByText('Finding your shoot').click();

      await choosePhotos(page, FIXTURE_PATHS);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await shot(page, testInfo, 'setup-3-photos');

      await scrollPageTo(page.getByRole('region', { name: 'What to Pick' }));
      await shot(page, testInfo, 'setup-4-what-to-pick');

      await page.getByRole('button', { name: 'Edit Order' }).click();
      await scrollPageTo(page.getByRole('region', { name: 'Categories' }));
      await shot(page, testInfo, 'setup-5-edit-order');
      await page.getByRole('button', { name: 'Done' }).click();

      await scrollPageTo(page.getByRole('region', { name: 'Options' }));
      await shot(page, testInfo, 'setup-6-options');

      await setStepper(page, 'Total photos', 10);
      await scrollPageTo(page.getByRole('region', { name: 'What to Pick' }));
      await shot(page, testInfo, 'setup-7-invalid-plan');
    });

    test('analyzing screen, then saving many photos in batches', async ({ page }, testInfo) => {
      await stubShare(page);
      let releaseEngine!: () => void;
      const engineHeld = new Promise<void>((resolve) => (releaseEngine = resolve));
      await page.route(MODEL_URL, async (route) => {
        await engineHeld;
        await route.abort();
      });

      const copies = fixtureCopies(2);
      await openApp(page);
      await choosePhotos(page, copies);
      await setStepper(page, 'Total photos', 45);
      await categorySwitch(page, 'Avoid near-duplicates').click();
      await categorySwitch(page, 'Skip blurry photos').click();

      await page.getByRole('button', { name: 'Find Best Photos' }).click();
      await expect(page.locator('[data-stage="engine"]')).toBeVisible();
      await shot(page, testInfo, 'analyzing-1-engine');

      releaseEngine();
      await expect(page.locator('[data-stage="error"]')).toBeVisible({ timeout: 30_000 });
      await shot(page, testInfo, 'analyzing-2-engine-error');

      await page.unroute(MODEL_URL);
      await page.getByRole('button', { name: 'Try Again' }).click();
      await expect(page.locator('[data-screen="analyzing"]')).toContainText(/minutes? left/, { timeout: RESULTS_TIMEOUT });
      await expect(page.getByTestId('analyzing-title')).toHaveText(new RegExp(`^Analyzing \\d+ of ${copies.length}$`));
      await shot(page, testInfo, 'analyzing-3-progress');

      await expect(page.locator('[data-screen="results"]')).toBeVisible({ timeout: RESULTS_TIMEOUT });
      await expect(saveButton(page)).toHaveText('Save 45 Photos');
      await saveButton(page).click();
      await page.getByRole('button', { name: 'Share 1–40' }).click();
      await page.evaluate(() => (window as unknown as { __finishShare: () => void }).__finishShare());
      await expect(page.getByRole('dialog')).toContainText('Shared');
      await shot(page, testInfo, 'results-6-batches');
    });

    test('results screen and detail sheet', async ({ page }, testInfo) => {
      await openApp(page);
      await choosePhotos(page, FIXTURE_PATHS);
      await findBestPhotos(page);
      await shot(page, testInfo, 'results-1-top');

      await scrollPageTo(page.locator('[data-section="groupShots"]'));
      await shot(page, testInfo, 'results-2-middle');

      await page.getByTestId('failures').locator('summary').click();
      await scrollPageToEnd(page);
      await shot(page, testInfo, 'results-3-end');

      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const sheet = await openFirstPick(page);
      await shot(page, testInfo, 'detail-1-photo');
      await sheet.getByRole('button', { name: 'Show Faces' }).click();
      await shot(page, testInfo, 'detail-2-faces');
      await scrollSheet(page, 'scores');
      await shot(page, testInfo, 'detail-3-metrics');
      await scrollSheet(page, 'end');
      await shot(page, testInfo, 'detail-4-alternatives');

      await sheet.getByRole('switch', { name: 'Keep in selection' }).click();
      await sheet.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(sheet).toBeHidden();
      await expect(page.locator('li.photo-tile[data-removed]')).toHaveCount(1);
      await shot(page, testInfo, 'results-4-removed');

      await page.getByRole('button', { name: 'Start Over' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot(page, testInfo, 'results-5-start-over');
    });

    test.describe('on a 320-point-wide screen', () => {
      test.use({ viewport: { width: 320, height: 568 } });

      test('setup, results and detail sheet', async ({ page }, testInfo) => {
        await openApp(page);
        await choosePhotos(page, FIXTURE_PATHS);
        await shot(page, testInfo, 'narrow-1-setup');
        await page.getByRole('button', { name: 'Edit Order' }).click();
        await scrollPageTo(page.getByRole('region', { name: 'Categories' }));
        await shot(page, testInfo, 'narrow-2-edit-order');
        await page.getByRole('button', { name: 'Done' }).click();
        await scrollPageTo(page.getByRole('region', { name: 'Options' }));
        await shot(page, testInfo, 'narrow-3-options');

        await findBestPhotos(page);
        await shot(page, testInfo, 'narrow-4-results');
        await scrollPageToEnd(page);
        await shot(page, testInfo, 'narrow-5-results-end');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await openFirstPick(page);
        await shot(page, testInfo, 'narrow-6-detail');
        await scrollSheet(page, 'scores');
        await shot(page, testInfo, 'narrow-7-detail-metrics');
        await scrollSheet(page, 'end');
        await shot(page, testInfo, 'narrow-8-detail-end');
      });
    });
  });
}

test.describe('light mode, big selection', () => {
  test.use({ colorScheme: 'light' });

  test('saving it as several ZIP files', async ({ page }, testInfo) => {
    const dir = testInfo.outputPath('big-photos');
    try {
      const photos = writeBigPhotos(dir);
      await removeShare(page);
      await openApp(page);
      await choosePhotos(page, photos);
      await applyPickAllPlan(page, photos.length);
      await findBestPhotos(page);
      await saveButton(page).click();
      const sheet = page.getByRole('dialog', { name: `Download ${photos.length} Photos` });
      const downloading = page.waitForEvent('download');
      await sheet.getByRole('button', { name: 'Download' }).first().click();
      await (await downloading).delete();
      await expect(sheet.locator('.batch-row').first()).toContainText('Downloaded');
      await capture(page, testInfo, 'results-7-zip-parts-light');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
