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

test('the fidelity stays in the top bar with the sidebar closed, and opens the details', async ({
  page,
}) => {
  await page.goto('./?prg=charge-discharge');
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar')).toBeHidden();

  const chip = page.getByTestId('fidelity-chip');
  await expect(chip).toHaveText('original');
  await chip.click();

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('meta-notes')).toContainText('first mini-model');
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
  await expect(page.getByTestId('fidelity-chip')).toHaveText('verbatim');
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
});
