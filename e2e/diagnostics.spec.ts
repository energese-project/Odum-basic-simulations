import { expect, test } from '@playwright/test';

/**
 * The editor checks a listing as it is typed, using the C engine compiled to
 * wasm (src/basic/engine.ts). The unit tests cover what the engine reports;
 * these cover the part only a browser can answer — that the module is fetched
 * and instantiated from the built bundle, and that a diagnostic becomes a mark
 * on the page.
 */

const ROOT = './';

/** Monaco renders an error marker as this decoration on the offending range. */
const ERROR_SQUIGGLY = '.squiggly-error';

test('a listing with a syntax error is marked in the editor', async ({ page }) => {
  await page.goto(ROOT);
  const mount = page.getByTestId('editor-mount');
  await expect(mount).toBeVisible();

  await mount.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10 PRINT (1 +\n');

  // The wasm module is fetched on first use, so the first mark is slower than
  // the debounce alone.
  await expect(mount.locator(ERROR_SQUIGGLY).first()).toBeVisible({ timeout: 15_000 });
});

test('correcting the listing clears the mark', async ({ page }) => {
  await page.goto(ROOT);
  const mount = page.getByTestId('editor-mount');
  await mount.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10 PRINT (1 +\n');
  await expect(mount.locator(ERROR_SQUIGGLY).first()).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10 PRINT 1\n20 END\n');

  // A checker that only ever adds markers would pass the test above and still
  // be useless.
  await expect(mount.locator(ERROR_SQUIGGLY)).toHaveCount(0, { timeout: 15_000 });
});

test('an archive program loads without being marked', async ({ page }) => {
  await page.goto(ROOT);
  await page.getByTestId('program-select').selectOption('charge-discharge');

  const mount = page.getByTestId('editor-mount');
  await expect(mount).toContainText('PRINT');

  // Every published listing must pass the checker the editor runs; a false
  // positive here is worse than no checker, because it accuses the archive.
  await page.waitForTimeout(2_000);
  await expect(mount.locator(ERROR_SQUIGGLY)).toHaveCount(0);
});
