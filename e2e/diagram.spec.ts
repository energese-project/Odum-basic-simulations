import { expect, test } from '@playwright/test';

/**
 * A listing is half of what Odum published; the energy systems diagram beside
 * it is the other half, and usually the easier one to check a model against.
 * When a program has one it sits above the plot. On what basis it is
 * reproduced here is in the program's sidecar, one click away in the explorer.
 */

test('a program with a diagram shows it above the plot, loaded and captioned', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');

  const pane = page.getByTestId('diagram-pane');
  await expect(pane).toBeVisible();

  const image = pane.getByRole('img');
  await expect(image).toHaveAttribute('alt', /source J fills the storage Q/);
  await expect(image).toHaveAttribute('src', /programs\/charge-discharge\.png$/);
  // A broken image is still an <img>; only a decoded one has a natural width.
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  // The full-size image is one click away — a scan is only checkable at full size.
  await expect(pane.getByRole('link')).toHaveAttribute('href', /programs\/charge-discharge\.png$/);

  const diagram = await pane.boundingBox();
  const plot = await page.getByTestId('chart-empty').boundingBox();
  expect(diagram!.y + diagram!.height).toBeLessThanOrEqual(plot!.y);
});

test('a reproduced figure is located in its source', async ({ page }) => {
  // No program in the archive reproduces a published figure yet, so this one is
  // exercised against a catalog with the figure reference added.
  await page.route('**/programs/index.json', async (route) => {
    const catalog = await (await route.fetch()).json();
    const program = catalog.programs.find((p: { id: string }) => p.id === 'charge-discharge');
    program.diagram = {
      ...program.diagram,
      figure: 'Figure 5-3, p. 112',
      rights: { basis: 'fair-use', statement: 'Reproduced for scholarship.' },
    };
    await route.fulfill({ json: catalog });
  });

  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('diagram-pane')).toContainText('Figure 5-3, p. 112');
});

test('a program with no diagram gives the plot the room instead', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('diagram-pane')).toBeVisible();

  await page.getByTestId('library-list').getByRole('treeitem', { name: /^Two Tanks/ }).click();
  await expect(page.getByTestId('editor-filename')).toHaveText('two-tank.bas');
  await expect(page.getByTestId('diagram-pane')).toBeHidden();
});
