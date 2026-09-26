import { expect, test, type Page } from '@playwright/test';

/**
 * The later listings draw their results on the PC's screen instead of printing a
 * table — both in Odum (1989), Simulation 53(2), among them. The workbench shows
 * them as it shows every program: a chart, a table and a CSV, read from the points
 * they PSET (src/basic/draw-plot.ts). What the PC drew pixel for pixel is compared
 * against PC-BASIC in validation/oracle/, not here. Continue is CONT, for the
 * listings that END part-way and expect to be carried on.
 */

/** Load `listing` in place of the stock program. */
async function withListing(page: Page, listing: string): Promise<void> {
  await page.route('**/programs/index.json', async (route) => {
    const catalog = await (await route.fetch()).json();
    const program = catalog.programs.find((p: { id: string }) => p.id === 'charge-discharge');
    program.listing = listing;
    await route.fulfill({ json: catalog });
  });
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('10');
}

// The frame and PSET loop of the 1989 listings, in miniature.
const DRAWING = [
  '5 SCREEN 1,0: COLOR 0,0',
  '6 LINE (0,0)-(319,180),3,B',
  '10 FOR T = 0 TO 319',
  '20 PSET (T, 180 - T / 2), 2',
  '30 NEXT T',
].join('\n');

test('a program that draws is plotted like one that prints: a chart, a table and a CSV', async ({ page }) => {
  await withListing(page, DRAWING);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });

  const chart = page.getByTestId('chart-canvas');
  await expect(chart).toBeVisible();
  // Named by what the listing wrote, in the listing's own screen coordinates.
  await expect(chart).toHaveAttribute('aria-label', /x: T; y: screen row.*line 20: 180 - T \/ 2/);
  await expect(page.getByTestId('status')).toHaveText('');

  // It printed nothing, so the output pane shows the points, and says that is what they are.
  const output = page.getByTestId('console-output');
  await expect(output).toContainText('plotted');
  await expect(output).toContainText('RUN   LINE   X');
  await expect(page.getByTestId('download')).toBeEnabled();

  const download = page.waitForEvent('download');
  await page.getByTestId('download').click();
  const csv = await (await (await download).createReadStream()).toArray();
  const text = Buffer.concat(csv).toString('utf8');
  expect(text.split('\n')[0]).toBe('run,line,x,y');
  expect(text.split('\n')[1]).toBe('1,20,0,180');
});

test('Continue carries on after END, as CONT did, and says what the listing says it does', async ({ page }) => {
  // Table 2 of the 1989 paper ENDs after its first run and says, in the next line,
  // "Type CONT to rerun with rewnable resources".
  await withListing(
    page,
    '10 X = 1\n20 PRINT "FIRST"; X\n30 END\n40 REM Type CONT for the second run\n50 X = X + 1\n60 PRINT "SECOND"; X',
  );
  const output = page.getByTestId('console-output');
  const resume = page.getByTestId('continue');

  await expect(resume).toBeHidden();
  await page.getByTestId('run').click();
  await expect(output).toContainText('FIRST 1');
  await expect(resume).toBeVisible();
  await expect(resume).toHaveText('Continue (CONT)');
  await expect(page.getByTestId('status')).toContainText('line 40');
  await expect(page.getByTestId('status')).toContainText('Type CONT for the second run');
  await expect(output).not.toContainText('SECOND');

  await resume.click();
  await expect(output).toContainText('SECOND 2', { timeout: 15_000 });
  await expect(resume, 'it ran to the end: nothing is left to continue').toBeHidden();
  await expect(page.getByTestId('run')).toBeEnabled();
});

test('a run after CONT is plotted as a run of its own', async ({ page }) => {
  await withListing(page, `${DRAWING}\n40 END\n50 GOTO 10`);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('continue')).toBeVisible({ timeout: 15_000 });
  const chart = page.getByTestId('chart-canvas');
  await expect(chart).not.toHaveAttribute('aria-label', /run 2/);

  await page.getByTestId('continue').click();
  await expect(page.getByTestId('continue')).toBeVisible({ timeout: 15_000 });
  await expect(chart).toHaveAttribute('aria-label', /line 20: 180 - T \/ 2, run 1.*line 20: 180 - T \/ 2, run 2/);

  // Each run is its own 320 points: CONT must not send the first run's again.
  const download = page.waitForEvent('download');
  await page.getByTestId('download').click();
  const text = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString('utf8');
  const rows = text.trim().split('\n').slice(1);
  expect(rows.filter((r) => r.startsWith('1,')).length).toBe(320);
  expect(rows.filter((r) => r.startsWith('2,')).length).toBe(320);
});

test('a new run starts clean: no runs, points or Continue left over', async ({ page }) => {
  await withListing(page, `${DRAWING}\n40 END\n50 PRINT "MORE"`);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('continue')).toBeVisible({ timeout: 15_000 });

  // Editing the program and running it again is a fresh start, not a CONT.
  const editor = page.getByTestId('editor-mount');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10 PRINT 0, 1\n20 PRINT 1, 2\n30 PRINT 2, 4');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });

  await expect(page.getByTestId('chart-canvas')).not.toHaveAttribute('aria-label', /line 20/);
  await expect(page.getByTestId('console-output')).not.toContainText('plotted');
  await expect(page.getByTestId('continue')).toBeHidden();
});
