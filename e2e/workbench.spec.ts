import { expect, test } from '@playwright/test';

// baseURL carries the Vite base, so './' is the app root and './about' is a
// route under it. A leading-slash path would escape to the domain root.
const ROOT = './';

test('the workbench loads with a program in the editor', async ({ page }) => {
  await page.goto(ROOT);

  await expect(page.getByRole('heading', { name: 'Odum BASIC Simulations' })).toBeVisible();
  await expect(page.getByTestId('editor-mount')).toBeVisible();

  const select = page.getByTestId('program-select');
  const options = await select.locator('option').allTextContents();
  expect(options.length).toBeGreaterThan(1);
  expect(options).toContain('Charge And Discharge');

  // The glob-built library is what fills the list; an empty editor would mean
  // the .bas files did not make it into the bundle.
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
});

test('running a simulation prints a table and draws a chart', async ({ page }) => {
  await page.goto(ROOT);
  await page.getByTestId('program-select').selectOption('charge-discharge');

  await expect(page.getByTestId('chart-empty')).toBeVisible();
  await page.getByTestId('run').click();

  // The run button returns from disabled when the program finishes.
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });

  const output = page.getByTestId('console-output');
  await expect(output).toContainText('OUTFLOW');
  await expect(output).toContainText('STEADY STATE');

  await expect(page.getByTestId('chart-canvas')).toBeVisible();
  await expect(page.getByTestId('chart-empty')).toBeHidden();
  await expect(page.getByTestId('download')).toBeEnabled();
});

test('a program with no numeric table says so instead of drawing an empty chart', async ({
  page,
}) => {
  await page.goto(ROOT);
  await page.getByTestId('program-select').selectOption('hello');
  await page.getByTestId('run').click();

  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('console-output')).toContainText('HELLO WORLD');
  await expect(page.getByTestId('status')).toContainText('no numeric table');
  await expect(page.getByTestId('chart-empty')).toBeVisible();
  await expect(page.getByTestId('download')).toBeDisabled();
});

test('INPUT round-trips through the console', async ({ page }) => {
  await page.goto(ROOT);
  await page.getByTestId('program-select').selectOption('guess');
  await page.getByTestId('run').click();

  const input = page.getByTestId('console-input');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill('50');
  await input.press('Enter');

  // Whatever the hidden number is, one of the three responses must appear.
  await expect(page.getByTestId('console-output')).toContainText(
    /TOO LOW|TOO HIGH|CORRECT/,
    { timeout: 15_000 }
  );
});

test('a runaway program can be stopped', async ({ page }) => {
  await page.goto(ROOT);

  // Type an endless loop over whatever was loaded. This is the case the Web
  // Worker exists for: on the main thread the page would be frozen here and the
  // stop button unclickable.
  const editor = page.getByTestId('editor-mount');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10 X = X + 1\n20 GOTO 10');

  await page.getByTestId('run').click();
  await expect(page.getByTestId('stop')).toBeEnabled();
  await expect(page.getByTestId('status')).toContainText('running');

  await page.getByTestId('stop').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByTestId('stop')).toBeDisabled();
});

test('?prg= selects a program, and the picker keeps the URL in step', async ({ page }) => {
  await page.goto('./?prg=logistic-growth');
  await expect(page.getByTestId('program-select')).toHaveValue('logistic-growth');
  await expect(page.getByTestId('editor-mount')).toContainText('SOURCE');

  await page.getByTestId('program-select').selectOption('two-tank');
  await expect(page).toHaveURL(/\?prg=two-tank/);
});

test('the about page is reachable and links back', async ({ page }) => {
  await page.goto(ROOT);
  await page.getByRole('link', { name: 'About' }).click();

  await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/about$/);

  await page.getByRole('link', { name: /Back to the workbench/ }).click();
  await expect(page.getByTestId('program-select')).toBeVisible();
});

test('a deep link to /about renders that page directly', async ({ page }) => {
  // Works in production because deploy.yml copies index.html to 404.html.
  await page.goto('./about');
  await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
});
