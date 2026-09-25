import { expect, test, type Page } from '@playwright/test';

/**
 * The explorer works like the one in VS Code, because that is the file tree
 * most readers already have in their hands: folders open and close on their
 * own, the chevron only folds, the arrow keys walk the tree, typing jumps to a
 * name, and Collapse All folds everything. It is a real ARIA tree, so all of
 * that reaches a screen reader as a tree rather than as a pile of buttons.
 */

function tree(page: Page) {
  return page.getByTestId('library-list');
}

function item(page: Page, name: string | RegExp) {
  return tree(page).getByRole('treeitem', typeof name === 'string' ? { name, exact: true } : { name });
}

test('it is an ARIA tree, with levels', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await expect(tree(page)).toHaveAttribute('role', 'tree');
  await expect(item(page, /^Charge And Discharge/)).toHaveAttribute('aria-level', '1');
  await expect(item(page, /^Charge And Discharge/)).toHaveAttribute('aria-expanded', 'true');
  await expect(item(page, 'charge-discharge.json')).toHaveAttribute('aria-level', '2');
  await expect(item(page, /^Hello/)).toHaveAttribute('aria-expanded', 'false');
});

test('the chevron folds a folder without opening anything', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');

  await item(page, /^Hello/).locator('.twistie').click();
  await expect(item(page, 'hello.bas')).toBeVisible();
  // Still the program that was open: expanding is looking, not loading.
  await expect(page).toHaveURL(/\?prg=charge-discharge$/);
  await expect(page.getByTestId('editor-filename')).toHaveText('charge-discharge.bas');

  // Folders are independent; opening one leaves the other open.
  await expect(item(page, 'charge-discharge.bas')).toBeVisible();

  await item(page, /^Charge And Discharge/).locator('.twistie').click();
  await expect(item(page, 'charge-discharge.bas')).toHaveCount(0);
  await expect(item(page, 'hello.bas')).toBeVisible();
});

test('a file of another program opens that program, and the tree keeps its state', async ({
  page,
}) => {
  await page.goto('./?prg=charge-discharge');
  await page.getByTestId('library-filter').fill('mini');
  await item(page, /^Logistic Growth/).locator('.twistie').click();

  await item(page, 'logistic-growth.json').click();
  await expect(page).toHaveURL(/\?prg=logistic-growth&file=logistic-growth\.json$/);
  await expect(page.getByTestId('editor-filename')).toHaveText('logistic-growth.json');
  await expect(page.getByTestId('editor-mount')).toContainText('"fidelity"');

  // Not rebuilt from the address bar: the filter and the open folders survive.
  await expect(page.getByTestId('library-filter')).toHaveValue('mini');
  await expect(item(page, 'charge-discharge.bas')).toBeVisible();
});

test('the arrow keys walk the tree, and Enter opens a file', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');

  // One tab stop for the whole tree, on the selected row.
  await item(page, 'charge-discharge.bas').focus();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'charge-discharge.json')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor-filename')).toHaveText('charge-discharge.json');

  // Left goes to the parent, and Left again folds it.
  await item(page, 'charge-discharge.json').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, /^Charge And Discharge/)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, /^Charge And Discharge/)).toHaveAttribute('aria-expanded', 'false');
  // Right unfolds it, and Right again steps into it.
  await page.keyboard.press('ArrowRight');
  await expect(item(page, /^Charge And Discharge/)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(item(page, 'charge-discharge.bas')).toBeFocused();

  await page.keyboard.press('End');
  await expect(item(page, /^Two Tanks/)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(item(page, /^Charge And Discharge/)).toBeFocused();
});

test('typing a name jumps to it', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await item(page, 'charge-discharge.bas').focus();
  await page.keyboard.type('log');
  await expect(item(page, /^Logistic Growth/)).toBeFocused();
});

test('Collapse All folds every folder', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await item(page, /^Hello/).locator('.twistie').click();
  await expect(item(page, 'hello.bas')).toBeVisible();

  await page.getByTestId('collapse-all').click();
  await expect(tree(page).locator('[aria-expanded="true"]')).toHaveCount(0);
  await expect(tree(page).locator('[data-kind="file"]')).toHaveCount(0);
});

test('a work is a folder, holding its source and a folder per model', async ({ page }) => {
  await page.goto('./?prg=odum_simulation_1989/macroeconomics');

  await expect(item(page, 'odum_simulation_1989')).toHaveAttribute('aria-level', '1');
  await expect(item(page, 'source.json')).toHaveAttribute('aria-level', '2');
  await expect(item(page, /^Macroeconomics Minimodel/)).toHaveAttribute('aria-level', '2');
  await expect(item(page, 'model.bas')).toHaveAttribute('aria-selected', 'true');
  // Revealed: the folders on the way to the open file are unfolded, and no others.
  await expect(item(page, 'runs')).toHaveAttribute('aria-level', '3');
  await expect(item(page, 'runs')).toHaveAttribute('aria-expanded', 'false');
  await item(page, 'runs').locator('.twistie').click();
  await expect(item(page, 'fig3.json')).toHaveAttribute('aria-level', '4');
});
