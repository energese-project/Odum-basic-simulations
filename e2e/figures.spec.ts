import { expect, test, type Page } from '@playwright/test';

/**
 * The paper's figures, and a visual regression suite, in one.
 *
 * Each screenshot here is compared against a committed golden in e2e/figures/,
 * and docs/article.tex includes those same PNGs. So the figures in the paper are
 * reproducible from the repository at any commit, and a change that alters what
 * the workbench looks like fails CI until its golden is regenerated on purpose:
 *
 *   make figures-update     # rewrite the goldens, then review the diff in git
 *
 * Goldens are pixel comparisons, so they are only meaningful in one environment:
 * the Containerfile's Debian image on arm64, which is what `make test` runs here
 * and what the `figures` job in ci.yml runs on GitHub. The other CI job, on the
 * stock Ubuntu runner, skips this file — its fonts are different, and every
 * figure would fail on text rendering alone.
 *
 * The project that runs this file (see playwright.config.js) fixes the viewport,
 * a 2x device scale for print, the light scheme, since the paper is printed, and
 * e2e/figures.css, which stills what would otherwise move between runs.
 */

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // A clicked button keeps focus, and its ring would be in the picture.
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

async function run(page: Page, id: string): Promise<void> {
  await page.goto(`./?prg=${id}`);
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('chart-canvas')).toBeVisible();
  await settle(page);
}

test('the workbench, with the first mini-model run', async ({ page }) => {
  await run(page, 'charge-discharge');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  const image = page.getByTestId('diagram-pane').getByRole('img');
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  await expect(page).toHaveScreenshot('workbench.png');
});

test('the first mini-model: its diagram, and the plot recovered from its listing', async ({
  page,
}) => {
  await run(page, 'charge-discharge');
  const diagram = page.getByTestId('diagram-pane');
  await expect
    .poll(() => diagram.getByRole('img').evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  await expect(diagram).toHaveScreenshot('minimodel-diagram.png');
  await expect(page.locator('.chart-block')).toHaveScreenshot('minimodel-plot.png');
});

test('a copied program in the workspace, checked as it is described', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await page.getByTestId('copy-to-workspace').click();
  await expect(page).toHaveURL(/\?my=charge-discharge-copy$/);

  // Claiming the copy is the published listing is exactly what the form stops:
  // verbatim needs a source, and the copy has none.
  await page.getByTestId('form-fidelity').selectOption('verbatim');
  await expect(page.getByTestId('form-problems')).toContainText('"source" is required');
  await settle(page);

  await expect(page.getByTestId('sidebar')).toHaveScreenshot('workspace-form.png');
});
