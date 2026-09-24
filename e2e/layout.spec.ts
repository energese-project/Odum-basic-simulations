import { expect, test, type Page } from '@playwright/test';

/**
 * The workbench is an application, not a page about one. What the site is for
 * lives on /about; this screen is the editor, the plot and the output, edge to
 * edge, with one thin bar above them and the archive's files in a sidebar.
 *
 * The one thing that must never go behind a click is the fidelity: whether a
 * listing is the published one or something written here changes what every
 * number on the screen means. So it is on every program's row in the explorer.
 */

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`${testId} is not rendered`);
  return b;
}

test('there is no explanatory masthead on the workbench — that is the about page', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
  await expect(page.getByText(/instead of on a teletype/)).toHaveCount(0);

  const bar = await box(page, 'topbar');
  expect(bar.height, 'the top bar is one thin row').toBeLessThanOrEqual(44);
  expect(bar.y).toBe(0);
});

test('the panes run edge to edge, with no gutter around them', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar')).toBeHidden();

  const viewport = page.viewportSize()!;
  const bar = await box(page, 'topbar');
  const editor = await box(page, 'editor-pane');
  const output = await box(page, 'output-pane');

  expect(editor.x).toBe(0);
  expect(Math.abs(editor.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(output.x + output.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(editor.y + editor.height - viewport.height)).toBeLessThanOrEqual(1);
});

test('the sidebar is open by default on a wide screen, and remembers being closed', async ({
  page,
}) => {
  await page.goto('./');
  const toggle = page.getByTestId('sidebar-toggle');

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.click();
  await expect(page.getByTestId('sidebar')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await page.reload();
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
  await expect(page.getByTestId('sidebar')).toBeHidden();
});

test('the top bar has Run and Contribute, and no program picker', async ({ page }) => {
  // The explorer is the one way to pick a program; a dropdown beside it was a
  // second copy of the same list that could disagree with it.
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
  await expect(page.getByTestId('program-select')).toHaveCount(0);
  await expect(page.getByTestId('fidelity-chip')).toHaveCount(0);

  const bar = await box(page, 'topbar');
  const run = await box(page, 'run');
  expect(run.y).toBeGreaterThanOrEqual(bar.y);
  expect(run.y + run.height).toBeLessThanOrEqual(bar.y + bar.height);

  const about = await page.getByRole('link', { name: 'About' }).boundingBox();
  const viewport = page.viewportSize()!;
  expect(viewport.width - (about!.x + about!.width), 'About stays at the far right').toBeLessThan(80);

  const contribute = await box(page, 'contribute');
  expect(contribute.x, 'Contribute is on the right, with About').toBeGreaterThan(viewport.width / 2);
});

test('Contribute opens the Add a program form on GitHub', async ({ page }) => {
  // There is no editing of the archive in the app: a program arrives through
  // the issue form, which labels the issue for the bot and for Jules.
  await page.goto('./');
  const contribute = page.getByTestId('contribute');
  await expect(contribute).toHaveAttribute(
    'href',
    'https://github.com/energese-project/Odum-basic-simulations/issues/new?template=add-program.yml'
  );
  await expect(contribute).toHaveAttribute('target', '_blank');
  await expect(contribute).toHaveAttribute('rel', /noopener/);
});

test('the library lists every program, and picking one loads it', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  const library = page.getByTestId('library-list');

  const catalog = await (await page.request.get('./programs/index.json')).json();
  await expect(library.locator('[data-kind="program"]')).toHaveCount(catalog.programs.length);
  await expect(library.getByRole('treeitem', { name: /^Charge And Discharge/ })).toHaveAttribute(
    'aria-current',
    'true'
  );

  await library.getByRole('treeitem', { name: /^Logistic Growth/ }).click();
  await expect(page).toHaveURL(/\?prg=logistic-growth$/);
  await expect(page.getByTestId('editor-filename')).toHaveText('logistic-growth.bas');
  await expect(library.getByRole('treeitem', { name: /^Logistic Growth/ })).toHaveAttribute(
    'aria-current',
    'true'
  );
});

test('a program\'s fidelity is on its row, with what it means', async ({ page }) => {
  await page.goto('./?prg=hello');
  const row = page.getByTestId('library-list').getByRole('treeitem', { name: /^Hello/ });
  await expect(row.locator('.badge')).toHaveText('original');
  await expect(row).toHaveAttribute('title', /Written for this repository/);
});

test('nothing interactive sits inside a <summary>', async ({ page }) => {
  // A <summary> is itself the control that folds its <details>. A button nested
  // in one is a control inside a control: keyboard and screen-reader users get
  // it inconsistently or not at all, and browsers flag it as a disallowed
  // descendant.
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');

  const nested = page.locator('summary').locator('a[href], button, input, select, textarea, [tabindex]');
  await expect(nested).toHaveCount(0);
});

test('the filter narrows the library', async ({ page }) => {
  await page.goto('./?prg=hello');
  const library = page.getByTestId('library-list');

  await page.getByTestId('library-filter').fill('logistic');
  await expect(library.locator('[data-kind="program"]')).toHaveCount(1);
  await expect(library).toContainText('Logistic Growth');

  await page.getByTestId('library-filter').fill('smoke-test');
  await expect(library.getByRole('treeitem', { name: /^Hello/ })).toBeVisible();
  await expect(library.getByRole('treeitem', { name: /^Logistic Growth/ })).toHaveCount(0);
});

test.describe('on a narrow screen', () => {
  test.use({ viewport: { width: 600, height: 900 } });

  test('the sidebar starts closed, and closes again once a program is picked', async ({
    page,
  }) => {
    await page.goto('./?prg=charge-discharge');
    await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
    await expect(page.getByTestId('sidebar')).toBeHidden();

    await page.getByTestId('sidebar-toggle').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();

    await page.getByTestId('library-list').getByRole('treeitem', { name: /^Two Tanks/ }).click();
    await expect(page).toHaveURL(/\?prg=two-tank/);
    await expect(page.getByTestId('sidebar')).toBeHidden();
  });

  test('a long run leaves the plot and the output at their own height', async ({ page }) => {
    // Stacked, the page scrolls instead of the panes, so nothing above the
    // canvas had a height of its own. Chart.js sized the canvas to its box, the
    // box grew to fit the canvas, and the output beside it grew with every row
    // printed: a 6,000-row run drew a plot 183,000px tall, and repainting that
    // is what froze the tab.
    await page.route('**/programs/index.json', async (route) => {
      const catalog = await (await route.fetch()).json();
      const program = catalog.programs.find((p: { id: string }) => p.id === 'charge-discharge');
      program.listing = program.listing.replace('LET DT = 0.5', 'LET DT = 0.05');
      await route.fulfill({ json: catalog });
    });
    await page.goto('./?prg=charge-discharge');
    await expect(page.getByTestId('editor-mount')).toContainText('PRINT');

    await page.getByTestId('run').click();
    await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId('console-output')).toContainText('STEADY STATE');

    const plot = await box(page, 'chart-canvas');
    const output = await box(page, 'console-output');
    expect(plot.height, 'the plot keeps a screen-sized height').toBeLessThanOrEqual(400);
    expect(output.height, 'the output keeps a screen-sized height').toBeLessThanOrEqual(400);

    // And stays there: the runaway was a resize loop, still growing after the
    // run had finished.
    await page.waitForTimeout(500);
    expect((await box(page, 'chart-canvas')).height).toBe(plot.height);

    // The rows are all still there, a scroll away rather than a page away.
    const scrolls = await page
      .getByTestId('console-output')
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls, 'the output scrolls within its own pane').toBe(true);
  });
});
