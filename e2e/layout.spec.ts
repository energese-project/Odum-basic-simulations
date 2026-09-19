import { expect, test, type Page } from '@playwright/test';

/**
 * The workbench is an application, not a page about one. What the site is for
 * lives on /about; this screen is the editor, the plot and the output, edge to
 * edge, with one thin bar above them and the provenance in a sidebar.
 *
 * The one thing that must never go behind a click is the fidelity: whether a
 * listing is the published one or something written here changes what every
 * number on the screen means. So it stays in the top bar, sidebar open or not.
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

test('the run controls sit beside the program picker, and the top bar has no fidelity chip', async ({
  page,
}) => {
  // Fidelity is on every row of the library and at the top of the details; a
  // third copy in the bar was noise. Run is what the bar is for, so it sits
  // next to the program it runs rather than at the far edge.
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
  await expect(page.getByTestId('fidelity-chip')).toHaveCount(0);

  const picker = await box(page, 'program-select');
  const run = await box(page, 'run');
  expect(run.x).toBeGreaterThan(picker.x + picker.width);
  expect(run.x - (picker.x + picker.width), 'Run is next to the picker').toBeLessThanOrEqual(24);

  const about = await page.getByRole('link', { name: 'About' }).boundingBox();
  const viewport = page.viewportSize()!;
  expect(viewport.width - (about!.x + about!.width), 'About stays at the far right').toBeLessThan(80);
});

test('the library lists every program, and picking one loads it', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  const library = page.getByTestId('library-list');

  const catalog = await (await page.request.get('./programs/index.json')).json();
  await expect(library.getByRole('button')).toHaveCount(catalog.programs.length);
  await expect(library.getByRole('button', { name: /Charge And Discharge/ })).toHaveAttribute(
    'aria-current',
    'true'
  );

  await library.getByRole('button', { name: /Logistic Growth/ }).click();
  await expect(page).toHaveURL(/\?prg=logistic-growth/);
  await expect(page.getByTestId('program-select')).toHaveValue('logistic-growth');
  await expect(page.getByTestId('editor-filename')).toHaveText('logistic-growth.bas');
  await expect(page.getByTestId('meta-title')).toHaveText('Logistic Growth');
  await expect(library.getByRole('button', { name: /Logistic Growth/ })).toHaveAttribute(
    'aria-current',
    'true'
  );
});

test('nothing interactive sits inside a <summary>', async ({ page }) => {
  // A <summary> is itself the control that folds its <details>. A button nested
  // in one is a control inside a control: keyboard and screen-reader users get
  // it inconsistently or not at all, and browsers flag it as a disallowed
  // descendant. The New program button used to live in the My programs summary.
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
  await expect(page.getByTestId('workspace-new')).toBeVisible();

  const nested = page.locator('summary').locator('a[href], button, input, select, textarea, [tabindex]');
  await expect(nested).toHaveCount(0);

  // Still on the My programs heading row, where it was.
  const heading = await page.locator('summary', { hasText: 'My programs' }).boundingBox();
  const add = await box(page, 'workspace-new');
  expect(add.y).toBeGreaterThanOrEqual(heading!.y);
  expect(add.y + add.height).toBeLessThanOrEqual(heading!.y + heading!.height);
});

test('the filter narrows the library, and a tag in the details filters by it', async ({
  page,
}) => {
  await page.goto('./?prg=hello');
  const library = page.getByTestId('library-list');

  await page.getByTestId('library-filter').fill('logistic');
  await expect(library.getByRole('button')).toHaveCount(1);
  await expect(library.getByRole('button')).toContainText('Logistic Growth');

  await page.getByTestId('meta-tags').getByRole('button', { name: 'smoke-test' }).click();
  await expect(page.getByTestId('library-filter')).toHaveValue('smoke-test');
  await expect(library.getByRole('button', { name: /Hello/ })).toBeVisible();
  await expect(library.getByRole('button', { name: /Logistic Growth/ })).toHaveCount(0);
});

test('a cited program shows its full citation and a BibTeX entry', async ({ page }) => {
  // Every program in the archive today is a worked example with nothing to
  // cite, so the cited path is exercised against a catalog with one added.
  await page.route('**/programs/index.json', async (route) => {
    const catalog = await (await route.fetch()).json();
    const base = catalog.programs.find((p: { id: string }) => p.id === 'charge-discharge');
    catalog.programs.push({
      ...base,
      id: 'cited',
      file: 'cited.bas',
      title: 'A Cited Listing',
      fidelity: 'verbatim',
      notes: undefined,
      source: {
        type: 'book',
        author: ['Odum, Howard T.'],
        title: 'Systems Ecology: An Introduction',
        publisher: 'Wiley',
        address: 'New York',
        year: 1983,
        pages: '123-125',
      },
    });
    await route.fulfill({ json: catalog });
  });

  await page.goto('./?prg=cited');
  await expect(page.getByTestId('fidelity-badge')).toHaveText('verbatim');
  await expect(page.getByTestId('citation')).toHaveText(
    'H. T. Odum (1983). Systems Ecology: An Introduction. New York: Wiley. pp. 123-125.'
  );
  await expect(page.getByTestId('bibtex')).toContainText('@book{cited,', { useInnerText: false });
  await expect(page.getByTestId('bibtex')).toContainText('pages = {123--125}', {
    useInnerText: false,
  });

  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('meta-title')).toHaveText('Charge And Discharge');
  await expect(page.getByTestId('bibtex-block')).toBeHidden();
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

    await page.getByTestId('library-list').getByRole('button', { name: /Two Tanks/ }).click();
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
