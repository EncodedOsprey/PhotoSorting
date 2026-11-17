import { readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { ZIP_PART_MAX_BYTES } from '../../src/ui/lib/zip';
import {
  FIXTURE_COUNT,
  FIXTURE_PATHS,
  FIXTURES_DIR,
  RESULTS_TIMEOUT,
  analyzeWithTestPlan,
  applyPickAllPlan,
  categorySwitch,
  choosePhotos,
  findBestPhotos,
  fixtureCopies,
  openApp,
  removeShare,
  resultSection,
  saveButton,
  setStepper,
  stepperInput,
  stubClipboard,
  stubShare,
  tileNames,
  toast,
  watchForAnalyzingScreen,
  writeBigPhotos,
} from './helpers';

// Playwright's WebKit on Linux turns the spaces of a download's name into underscores.
const ZIP_NAME = /^PhotoSorting[ _]Picks[ _]\d{4}-\d{2}-\d{2}\.zip$/;

const results = (page: Page) => page.locator('[data-screen="results"]');

type ShareState = { __shares: { names: string[]; sizes: number[]; types: string[] }[] };
const recordedShares = (page: Page) => page.evaluate(() => (window as unknown as ShareState).__shares);
const setShareMode = (page: Page, mode: 'hold' | 'abort' | 'fail') =>
  page.evaluate((value) => {
    (window as unknown as { __shareMode: string }).__shareMode = value;
  }, mode);
const finishShare = (page: Page) => page.evaluate(() => (window as unknown as { __finishShare?: () => void }).__finishShare?.());

async function openTile(page: Page, sectionKey: string, index: number) {
  const tile = resultSection(page, sectionKey).locator('li.photo-tile').nth(index);
  const name = await tile.getAttribute('data-name');
  await tile.getByRole('button').click();
  return { tile, name: name ?? '' };
}

test('finds the best photos, honoring the total and the number per category', async ({ page }) => {
  await analyzeWithTestPlan(page);

  await expect(page.getByTestId('results-summary')).toHaveText(`10 photos selected from ${FIXTURE_COUNT}`);
  const sections = page.locator('[data-section]');
  await expect(sections).toHaveCount(5);
  expect(await sections.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-section')))).toEqual([
    'groupShots',
    'bestSmiles',
    'portraits',
    'noPeople',
    'fill',
  ]);
  const expected: Record<string, number> = { groupShots: 1, bestSmiles: 3, portraits: 2, noPeople: 2, fill: 2 };
  for (const [key, count] of Object.entries(expected)) {
    const section = resultSection(page, key);
    await expect(section.getByTestId('section-count')).toHaveText(`${count} of ${count}`);
    await expect(section.locator('li.photo-tile')).toHaveCount(count);
    await expect(section.getByTestId('section-note')).toHaveCount(0);
  }
  await expect(resultSection(page, 'fill').getByRole('heading')).toHaveText('More Great Shots');

  const names = await tileNames(results(page));
  expect(new Set(names).size).toBe(10);
  // Group shots have 3+ people; scenery has none; smiles and portraits need faces.
  for (const name of await tileNames(resultSection(page, 'groupShots'))) expect(name).toMatch(/^group-/);
  for (const name of await tileNames(resultSection(page, 'noPeople'))) expect(name).toMatch(/^scene-/);
  for (const key of ['bestSmiles', 'portraits']) {
    for (const name of await tileNames(resultSection(page, key))) expect(name).not.toMatch(/^scene-/);
  }
  // Near-duplicates are avoided and blurry photos skipped (the defaults).
  expect(names.filter((name) => name.startsWith('portrait-smile-b')).length).toBeLessThanOrEqual(1);
  expect(names.filter((name) => name.startsWith('scene-rocket')).length).toBeLessThanOrEqual(1);
  expect(names.filter((name) => name.includes('blur-strong'))).toEqual([]);

  // Every tile shows a 0–100 score.
  for (const score of await results(page).locator('.photo-tile__score').allTextContents()) {
    expect(Number(score)).toBeGreaterThanOrEqual(0);
    expect(Number(score)).toBeLessThanOrEqual(100);
  }

  const failures = page.getByTestId('failures');
  await expect(failures.locator('summary')).toHaveText('1 photo couldn’t be opened');
  await failures.locator('summary').click();
  await expect(failures.locator('li')).toHaveCount(1);
  await expect(failures.locator('li strong')).toHaveText('corrupt.jpg');

  await expect(saveButton(page)).toHaveText('Save 10 Photos');
});

test('shows a pick up close, leaves it out, and swaps a pick for an alternative', async ({ page }) => {
  await analyzeWithTestPlan(page);
  const smiles = resultSection(page, 'bestSmiles');
  const sheet = page.getByRole('dialog', { name: 'Best Smiles' });

  const first = await openTile(page, 'bestSmiles', 0);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.detail__name')).toHaveText(first.name);
  const preview = sheet.getByTestId('detail-preview');
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  for (const meter of ['Best Smiles score', 'Smile', 'Eyes open', 'Sharpness', 'Exposure']) {
    await expect(sheet.getByRole('meter', { name: meter, exact: true }).first()).toBeAttached();
  }
  await expect(sheet.locator('.metrics__faces')).toContainText(/Faces\s*[1-9]/);
  await expect(sheet.locator('.info-row', { hasText: 'File' })).toContainText(first.name);
  await expect(sheet.locator('.info-row', { hasText: 'Taken' })).toContainText('2025');

  await sheet.getByRole('button', { name: 'Show Faces' }).click();
  await expect(sheet.locator('.face-box').first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Hide Faces' }).click();
  await expect(sheet.locator('.face-box')).toHaveCount(0);

  // Leave it out of the selection.
  const keep = sheet.getByRole('switch', { name: 'Keep in selection' });
  await expect(keep).toHaveAttribute('aria-checked', 'true');
  await keep.click();
  await expect(keep).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(first.tile).toHaveAttribute('data-removed', 'true');
  await expect(first.tile.getByRole('button')).toHaveAccessibleName(/, removed$/);
  await expect(smiles.getByTestId('section-count')).toHaveText('2 of 3');
  await expect(page.getByTestId('results-summary')).toHaveText(`9 photos selected from ${FIXTURE_COUNT}`);
  await expect(saveButton(page)).toHaveText('Save 9 Photos');

  // And put it back.
  await first.tile.getByRole('button').click();
  await keep.click();
  await expect(keep).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(first.tile).not.toHaveAttribute('data-removed');
  await expect(saveButton(page)).toHaveText('Save 10 Photos');

  // Swap the second pick for its best alternative.
  const second = await openTile(page, 'bestSmiles', 1);
  await expect(sheet.locator('.detail__name')).toHaveText(second.name);
  const alternative = sheet.locator('li.alternative').first();
  await expect(alternative).toBeVisible();
  const replacement = (await alternative.getAttribute('data-name')) ?? '';
  const before = await tileNames(results(page));
  expect(before).not.toContain(replacement);
  await alternative.getByRole('button', { name: `Use ${replacement} instead` }).click();
  await expect(toast(page)).toContainText(`Now using ${replacement}`);
  await expect(sheet.locator('.detail__name')).toHaveText(replacement);
  // The swapped-out photo is now an alternative itself.
  await expect(sheet.locator(`li.alternative[data-name="${second.name}"]`)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await expect(second.tile).toHaveAttribute('data-name', replacement);
  const after = await tileNames(results(page));
  expect(after).not.toContain(second.name);
  expect(after).toHaveLength(10);
  await expect(smiles.getByTestId('section-count')).toHaveText('3 of 3');
  await expect(saveButton(page)).toHaveText('Save 10 Photos');
});

test('saves the picks through the share sheet as the original files', async ({ page }) => {
  await stubShare(page);
  await analyzeWithTestPlan(page);
  const kept = await tileNames(results(page), { keptOnly: true });

  await saveButton(page).click();
  await expect(toast(page)).toContainText('In the share sheet, choose “Save 10 Images” to add them to Photos (they’re added as copies).');
  const [shared] = await recordedShares(page);
  expect([...shared.names].sort()).toEqual([...kept].sort());
  // The originals, byte for byte — not thumbnails or re-encoded copies.
  expect(shared.sizes).toEqual(shared.names.map((name) => statSync(path.join(FIXTURES_DIR, name)).size));
  expect(shared.types.every((type) => type.startsWith('image/'))).toBe(true);
  await finishShare(page);
  await expect(toast(page)).toContainText('Shared 10 photos.');

  // Cancelling the share sheet is silent.
  await setShareMode(page, 'abort');
  await saveButton(page).click();
  await expect(toast(page).locator('.toast')).toHaveCount(0);
  expect(await recordedShares(page)).toHaveLength(2);

  // Other errors explain and offer the ZIP file instead.
  await setShareMode(page, 'fail');
  await saveButton(page).click();
  await expect(toast(page)).toContainText('Couldn’t open the share sheet.');
  const download = page.waitForEvent('download');
  await toast(page).getByRole('button', { name: 'Download ZIP' }).click();
  expect((await download).suggestedFilename()).toMatch(ZIP_NAME);
  await expect(toast(page)).toContainText('Downloaded 10 photos as a ZIP file.');
});

test('shares more than 40 photos in batches of 40', async ({ page }) => {
  await stubShare(page);
  await openApp(page);
  await choosePhotos(page, fixtureCopies(2));
  await setStepper(page, 'Total photos', 45);
  // The copies are identical, so allow duplicates (and blurry photos) to reach 45.
  await page.getByRole('switch', { name: 'Avoid near-duplicates' }).click();
  await page.getByRole('switch', { name: 'Skip blurry photos' }).click();
  await findBestPhotos(page);
  await expect(saveButton(page)).toHaveText('Save 45 Photos');
  const kept = await tileNames(results(page), { keptOnly: true });
  expect(kept).toHaveLength(45);

  await saveButton(page).click();
  const batches = page.getByRole('dialog', { name: 'Save 45 Photos' });
  await expect(batches).toBeVisible();
  await expect(batches.getByRole('button', { name: /^Share / })).toHaveText(['Share 1–40', 'Share 41–45']);

  await batches.getByRole('button', { name: 'Share 1–40' }).click();
  await expect(toast(page)).toContainText('choose “Save 40 Images”');
  await finishShare(page);
  await expect(batches.locator('.batch-row').first()).toContainText('Shared');

  await batches.getByRole('button', { name: 'Share 41–45' }).click();
  await expect(toast(page)).toContainText('choose “Save 5 Images”');
  await finishShare(page);
  await expect(batches.locator('.batch-row').nth(1)).toContainText('Shared');

  const shares = await recordedShares(page);
  expect(shares.map((share) => share.names.length)).toEqual([40, 5]);
  expect(shares.flatMap((share) => share.names).sort()).toEqual([...kept].sort());
});

test('downloads a ZIP of the kept originals when sharing isn’t available, and copies their names', async ({ page }) => {
  await removeShare(page);
  await stubClipboard(page);
  await analyzeWithTestPlan(page);

  // Removed photos are left out.
  const removed = await openTile(page, 'portraits', 0);
  await page.getByRole('switch', { name: 'Keep in selection' }).click();
  await page.keyboard.press('Escape');
  await expect(removed.tile).toHaveAttribute('data-removed', 'true');
  const kept = await tileNames(results(page), { keptOnly: true });
  expect(kept).toHaveLength(9);
  expect(kept).not.toContain(removed.name);

  const downloading = page.waitForEvent('download');
  await saveButton(page).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(ZIP_NAME);
  const entries = unzipSync(new Uint8Array(readFileSync(await download.path())));
  expect(Object.keys(entries).sort()).toEqual([...kept].sort());
  for (const name of kept) {
    expect(Buffer.from(entries[name]).equals(readFileSync(path.join(FIXTURES_DIR, name))), name).toBe(true);
  }
  await expect(toast(page)).toContainText('Downloaded 9 photos as a ZIP file. Saving to Photos isn’t available in this browser.');

  await page.getByRole('button', { name: 'Copy File Names' }).click();
  await expect(toast(page)).toContainText('Copied 9 file names.');
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toHaveLength(1);
  expect(copied[0].split('\n').sort()).toEqual([...kept].sort());
});

test('downloads a big selection as several ZIP files, each small enough for iPhone', async ({ page }, testInfo) => {
  const dir = testInfo.outputPath('big-photos');
  try {
    const photos = writeBigPhotos(dir);
    await removeShare(page);
    await openApp(page);
    await choosePhotos(page, photos);
    await applyPickAllPlan(page, photos.length);
    await findBestPhotos(page);
    await expect(saveButton(page)).toHaveText('Save 6 Photos');
    const kept = await tileNames(results(page), { keptOnly: true });
    expect([...kept].sort()).toEqual(photos.map((photo) => path.basename(photo)).sort());

    await saveButton(page).click();
    const sheet = page.getByRole('dialog', { name: 'Download 6 Photos' });
    await expect(sheet).toContainText('Saving to Photos isn’t available in this browser.');
    const rows = sheet.locator('.batch-row');
    // The photos are about 47 MB each, so four fit in a ZIP file.
    await expect(rows.locator('.row__label')).toHaveText(['Photos 1–4', 'Photos 5–6']);
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const zipped: string[] = [];
    for (let index = 0; index < count; index++) {
      const row = rows.nth(index);
      const downloading = page.waitForEvent('download');
      await row.getByRole('button', { name: 'Download' }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(
        new RegExp(String.raw`^PhotoSorting[ _]Picks[ _]\d{4}-\d{2}-\d{2}[ _]\(${index + 1}[ _]of[ _]${count}\)\.zip$`),
      );
      const file = await download.path();
      expect(statSync(file).size).toBeLessThanOrEqual(ZIP_PART_MAX_BYTES);
      const entries = unzipSync(new Uint8Array(readFileSync(file)));
      for (const [name, data] of Object.entries(entries)) {
        expect(Buffer.from(data).equals(readFileSync(path.join(dir, name))), name).toBe(true);
      }
      zipped.push(...Object.keys(entries));
      await download.delete();
      await expect(row).toContainText('Downloaded');
      await expect(toast(page)).toContainText(`Downloaded ZIP file ${index + 1} of ${count}.`);
    }
    // Every kept photo, each in exactly one of the ZIP files.
    expect(zipped.sort()).toEqual([...kept].sort());

    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: 'Download ZIP' }).click();
    await expect(rows).toHaveCount(count);
    await expect(sheet).not.toContainText('Saving to Photos');
    await expect(sheet).not.toContainText('Downloaded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remembers the settings after a reload', async ({ page }) => {
  await openApp(page);
  await setStepper(page, 'Total photos', 11);
  await page.getByRole('button', { name: 'Increase Total photos' }).click();
  await expect(stepperInput(page, 'Total photos')).toHaveValue('12');
  await categorySwitch(page, 'Best Smiles').click();
  await categorySwitch(page, 'Sharpest Focus').click();
  await page.getByRole('button', { name: 'Decrease Sharpest Focus photos' }).click();
  await expect(stepperInput(page, 'Sharpest Focus photos')).toHaveValue('3');
  await page.getByRole('button', { name: 'Edit Order' }).click();
  await page.getByRole('button', { name: 'Move Portraits up' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('switch', { name: 'Skip closed eyes' }).click();
  const slider = page.getByRole('slider', { name: 'Duplicate sensitivity' });
  await slider.focus();
  for (let i = 0; i < 4; i++) await slider.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Very similar shots');

  const order = () => page.locator('li.category').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-category')));
  const expectedOrder = ['bestSmiles', 'portraits', 'groupShots', 'eyesOpen', 'sharpest', 'wellExposed', 'noPeople', 'bestOverall'];
  expect(await order()).toEqual(expectedOrder);
  const summary = '11 of 12 assigned · 1 filled with Best Overall';
  await expect(page.getByTestId('assignment-summary')).toHaveText(summary);

  await page.reload();
  await expect(stepperInput(page, 'Total photos')).toHaveValue('12');
  expect(await order()).toEqual(expectedOrder);
  await expect(categorySwitch(page, 'Best Smiles')).toHaveAttribute('aria-checked', 'false');
  await expect(categorySwitch(page, 'Sharpest Focus')).toHaveAttribute('aria-checked', 'true');
  await expect(stepperInput(page, 'Sharpest Focus photos')).toHaveValue('3');
  await expect(page.getByRole('switch', { name: 'Skip closed eyes' })).toHaveAttribute('aria-checked', 'true');
  await expect(slider).toHaveValue('0.3');
  await expect(page.getByTestId('assignment-summary')).toHaveText(summary);

  // Damaged settings fall back to the defaults.
  await page.evaluate(() => localStorage.setItem('photosorting.settings.v1', '{"version":1,"total":'));
  await page.reload();
  await expect(stepperInput(page, 'Total photos')).toHaveValue('20');
  await expect(page.getByTestId('assignment-summary')).toHaveText('16 of 20 assigned · 4 filled with Best Overall');
  await expect(page.locator('li.category')).toHaveCount(8);
});

/** Whether leaving the page now would ask first: browsers ask when the page cancels the beforeunload event. */
const asksBeforeLeaving = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

test('Cancel stops the analysis and keeps the photos analyzed so far', async ({ page, browserName }) => {
  const files = fixtureCopies(3);
  const count = files.length;
  await openApp(page);
  await choosePhotos(page, files);
  await page.getByRole('button', { name: 'Find Best Photos' }).click();

  const analyzing = page.locator('[data-screen="analyzing"]');
  const title = page.getByTestId('analyzing-title');
  await expect(analyzing).toBeVisible();
  await expect(analyzing.getByText('Keep PhotoSorting open until it finishes.')).toBeVisible();
  await expect(title).toHaveText(new RegExp(`^Analyzing ([4-9]|\\d{2}) of ${count}$`), { timeout: RESULTS_TIMEOUT });
  await expect(page.getByRole('progressbar', { name: 'Analysis progress' })).toBeVisible();
  await expect(analyzing.locator('.analyzing__card img')).toBeVisible();
  await expect(analyzing.locator('.analyzing__status')).toContainText(/left/);

  // Leaving mid-analysis asks first.
  expect(await asksBeforeLeaving(page)).toBe(true);
  // WebKit closes a page without asking when it doesn't answer within 50 ms, as a page busy analyzing sometimes can't.
  if (browserName === 'chromium') {
    const dialog = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    expect((await dialog).type()).toBe('beforeunload');
    await (await dialog).dismiss();
  }
  await expect(analyzing).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-screen="setup"]')).toBeVisible();
  await expect.poll(() => asksBeforeLeaving(page)).toBe(false);
  await expect(toast(page)).toContainText(/^Stopped\. The \d+ photos analyzed so far are kept\./);
  const done = Number(/The (\d+) photos/.exec((await toast(page).textContent()) ?? '')?.[1]);
  expect(done).toBeGreaterThanOrEqual(4);
  expect(done).toBeLessThan(count);
  await expect(page.getByTestId('photo-count')).toHaveText(`${count} photos selected`);
  await expect(page.locator('[data-screen="setup"]')).toContainText(`${done} already analyzed · ${count - done} new`);

  // Only the rest is analyzed next time.
  await page.getByRole('button', { name: 'Find Best Photos' }).click();
  await expect(title).toHaveText(new RegExp(` of ${count - done}$`));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-screen="setup"]')).toBeVisible();
});

test('Adjust Criteria re-runs the selection instantly without analyzing again; Start Over clears everything', async ({ page }) => {
  await analyzeWithTestPlan(page);
  await page.getByRole('button', { name: 'Adjust Criteria' }).click();
  await expect(page.locator('[data-screen="setup"]')).toBeVisible();
  await expect(page.locator('[data-screen="setup"]')).toContainText('All analyzed — results are instant.');

  await watchForAnalyzingScreen(page);
  await setStepper(page, 'Group Shots photos', 5);
  await setStepper(page, 'Total photos', 14);
  await findBestPhotos(page);
  expect(await page.evaluate(() => (window as unknown as { __sawAnalyzing: boolean }).__sawAnalyzing)).toBe(false);

  // There are only three group photos, so Group Shots comes up short and says why.
  const groupShots = resultSection(page, 'groupShots');
  const found = await groupShots.locator('li.photo-tile').count();
  expect(found).toBeGreaterThanOrEqual(1);
  expect(found).toBeLessThan(5);
  await expect(groupShots.getByTestId('section-count')).toHaveText(`${found} of 5`);
  await expect(groupShots.getByTestId('section-note')).toHaveText(`Only ${found} of 5 — not enough photos with 3+ people`);
  const total = await results(page).locator('li.photo-tile').count();
  await expect(page.getByTestId('results-summary')).toHaveText(`${total} photos selected from ${FIXTURE_COUNT}`);

  await page.getByRole('button', { name: 'Start Over' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Start Over' }).click();
  await expect(page.locator('[data-screen="setup"]')).toBeVisible();
  await expect(page.getByTestId('photo-count')).toHaveText('No photos yet');
  await expect(page.getByRole('button', { name: 'Find Best Photos' })).toBeDisabled();
  // The settings stay.
  await expect(stepperInput(page, 'Total photos')).toHaveValue('14');
});

test.describe('when the analysis engine can’t be downloaded', () => {
  test.use({ serviceWorkers: 'block' });

  test('says so while loading, then offers Try Again', async ({ page }) => {
    const model = '**/mediapipe/face_landmarker.task';
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(model, async (route) => {
      await held;
      await route.abort();
    });
    await openApp(page);
    await choosePhotos(page, FIXTURE_PATHS.slice(0, 4));
    await page.getByRole('button', { name: 'Find Best Photos' }).click();

    const analyzing = page.locator('[data-screen="analyzing"]');
    await expect(analyzing).toHaveAttribute('data-stage', 'engine');
    await expect(page.getByTestId('analyzing-title')).toHaveText('Getting Ready…');
    await expect(analyzing.locator('.analyzing__status')).toHaveText('Loading the analysis engine (about 18 MB, first time only)…');

    release();
    await expect(analyzing).toHaveAttribute('data-stage', 'error');
    await expect(analyzing.getByRole('alert')).not.toBeEmpty();

    await page.unroute(model);
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(results(page)).toBeVisible({ timeout: RESULTS_TIMEOUT });
    await expect(page.getByTestId('results-summary')).toContainText('from 4');
  });
});
