import { expect, test, type Page } from '@playwright/test';

// baseURL carries the Vite base, so './' is the app root and './about' is a
// route under it. A leading-slash path would escape to the domain root.
const ROOT = './';

test('the workbench loads with a program in the editor', async ({ page }) => {
  await page.goto(ROOT);

  await expect(page.getByRole('heading', { name: 'Odum BASIC Simulations' })).toBeVisible();
  await expect(page.getByTestId('editor-mount')).toBeVisible();

  // The explorer is the only way to pick a program; there is no dropdown.
  await expect(page.getByTestId('program-select')).toHaveCount(0);
  const library = page.getByTestId('library-list');
  await expect(library.locator(':scope > li')).not.toHaveCount(0);
  await expect(library.getByRole('button', { name: /^Charge And Discharge/ })).toBeVisible();

  // The catalog is what fills the list; an empty editor would mean the .bas
  // files did not make it into the published archive.
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
});

test('running a simulation prints a table and draws a chart', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');

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
  await page.goto('./?prg=hello');
  await page.getByTestId('run').click();

  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('console-output')).toContainText('HELLO WORLD');
  await expect(page.getByTestId('status')).toContainText('no numeric table');
  await expect(page.getByTestId('chart-empty')).toBeVisible();
  await expect(page.getByTestId('download')).toBeDisabled();
});

test('INPUT round-trips through the console', async ({ page }) => {
  await page.goto('./?prg=guess');
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
  // The answer is echoed onto the line that asked for it, not onto a new one.
  await expect(page.getByTestId('console-output')).toContainText('YOUR GUESS? 50\n', {
    useInnerText: false,
  });
});

/** The stock listing, with a step small enough to print `rows` rows. */
async function withRows(page: Page, rows: number): Promise<void> {
  await page.route('**/programs/index.json', async (route) => {
    const catalog = await (await route.fetch()).json();
    const program = catalog.programs.find((p: { id: string }) => p.id === 'charge-discharge');
    program.listing = program.listing.replace('LET DT = 0.5', `LET DT = ${60 / rows}`);
    await route.fulfill({ json: catalog });
  });
}

test('a long run leaves the page free while it prints', async ({ page }) => {
  // The interpreter is in a worker, but what it prints is laid out here. Output
  // appended to one <pre> re-laid out every line above it on each flush, and
  // the plot re-read the whole transcript on each redraw: 60,000 rows held the
  // main thread in tasks of up to 720ms, 5.9s of a 6.7s run.
  await page.addInitScript(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.longTasks.push(entry.duration);
    }).observe({ type: 'longtask' });
  });
  await withRows(page, 60_000);
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
  await page.evaluate(() => ((window as unknown as { longTasks: number[] }).longTasks = []));

  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId('console-output')).toContainText('STEADY STATE');

  const tasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  const longest = Math.max(0, ...tasks);
  expect(longest, `long tasks: ${tasks.map(Math.round).join(', ')}ms`).toBeLessThan(250);
});

test('the output copies exactly as it was printed', async ({ page }) => {
  // The console holds a run in pieces now. A copy of it is how a table leaves
  // the page, so the pieces must not add a line break where they join.
  await withRows(page, 6_000);
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 30_000 });

  const { copied, printed } = await page.getByTestId('console-output').evaluate((out) => {
    const selection = window.getSelection()!;
    selection.selectAllChildren(out);
    return { copied: selection.toString(), printed: out.textContent ?? '' };
  });
  // A number may open with its point: GW-BASIC prints .01, not 0.01, and the
  // engine follows it (validation/oracle/runs/print.txt). Counting only lines
  // that start with a digit would miss every row where T is below 1.
  const rows = printed.split('\n').filter((l) => /^ ?-?[\d.]/.test(l)).length;
  expect(rows, 'long enough to arrive in many pieces').toBeGreaterThanOrEqual(6_000);
  expect(copied.replace(/\n+$/, '')).toBe(printed.replace(/\n+$/, ''));
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

test('?prg= selects a program, and the explorer keeps the URL in step', async ({ page }) => {
  await page.goto('./?prg=logistic-growth');
  const library = page.getByTestId('library-list');
  await expect(library.getByRole('button', { name: /^Logistic Growth/ })).toHaveAttribute(
    'aria-current',
    'true'
  );
  await expect(page.getByTestId('editor-mount')).toContainText('SOURCE');

  await library.getByRole('button', { name: /^Two Tanks/ }).click();
  await expect(page).toHaveURL(/\?prg=two-tank/);
});

test('the about page is reachable and links back', async ({ page }) => {
  await page.goto(ROOT);
  await page.getByRole('link', { name: 'About' }).click();

  await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/about$/);

  await page.getByRole('link', { name: /Back to the workbench/ }).click();
  await expect(page.getByTestId('library-list')).toBeVisible();
});

test('a deep link to /about renders that page directly', async ({ page }) => {
  // Works in production because deploy.yml copies index.html to 404.html.
  await page.goto('./about');
  await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
});
