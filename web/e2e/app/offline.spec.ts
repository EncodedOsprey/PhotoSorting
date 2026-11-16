import path from 'node:path';
import { expect, test } from '@playwright/test';
import { choosePhotos, FIXTURES_DIR, openApp, RESULTS_TIMEOUT } from './helpers';

const PHOTOS = ['group-three.jpg', 'portrait-smile-a.jpg', 'scene-coffee.jpg'].map((name) => path.join(FIXTURES_DIR, name));

test('analyzes offline after one online visit, even if nothing was analyzed online', async ({ page, context }) => {
  await openApp(page);
  // The service worker takes control of this first page once it has precached the app and the analysis engine.
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), undefined, { timeout: 90_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-screen="setup"]')).toBeVisible();

  await choosePhotos(page, PHOTOS);
  await page.getByRole('button', { name: 'Find Best Photos' }).click();
  const results = page.locator('[data-screen="results"]');
  await expect(results.or(page.locator('[data-screen="analyzing"][data-stage="error"]'))).toBeVisible({
    timeout: RESULTS_TIMEOUT,
  });
  await expect(results).toBeVisible();
  await expect(results.locator('li.photo-tile')).toHaveCount(PHOTOS.length);
});
