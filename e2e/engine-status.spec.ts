import { expect, test } from '@playwright/test';

/**
 * The topbar light that says whether the wasm engine came up.
 *
 * The state it reports is real, so the failure case is tested by actually
 * breaking the fetch rather than by poking the component: a light that cannot
 * go red is not reporting anything.
 */

const ROOT = './';

test('the engine light turns green once the module is up', async ({ page }) => {
  await page.goto(ROOT);

  const status = page.getByTestId('engine-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect(page.getByTestId('engine-status-label')).toHaveText('Engine ready');
});

test('the light goes red when the module cannot be fetched, and says so', async ({ page }) => {
  // Before goto, so the very first request for it is the one that fails.
  await page.route('**/*.wasm', (route) => route.abort());
  await page.goto(ROOT);

  const status = page.getByTestId('engine-status');
  await expect(status).toHaveAttribute('data-state', 'unavailable', { timeout: 15_000 });
  await expect(page.getByTestId('engine-status-label')).toHaveText('Engine unavailable');
});

test('a failed engine leaves the rest of the workbench working', async ({ page }) => {
  await page.route('**/*.wasm', (route) => route.abort());
  await page.goto(ROOT);
  await expect(page.getByTestId('engine-status')).toHaveAttribute('data-state', 'unavailable', {
    timeout: 15_000,
  });

  // The engine only checks listings. Running goes through the TypeScript
  // interpreter, and must not have been taken down with it.
  await page.getByTestId('program-select').selectOption('charge-discharge');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('console-output')).toContainText('STEADY STATE');
});

test('the status is announced rather than left to colour alone', async ({ page }) => {
  await page.goto(ROOT);
  const status = page.getByTestId('engine-status');

  // The design system's rule for status colours: each ships with an icon or a
  // label. A green dot on its own would fail a colour-blind reader.
  await expect(status).toHaveRole('status');
  await expect(status).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect(status).toHaveAttribute('title', /checks your listing as you type/);
});
