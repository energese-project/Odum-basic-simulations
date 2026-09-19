import { expect, test, type Page } from '@playwright/test';

/**
 * The later listings draw their results on the PC's screen instead of printing a
 * table — both in Odum (1989), Simulation 53(2), among them. The workbench shows
 * that screen in the Plot pane, and Continue is CONT for the listings that END
 * part-way and expect to be carried on.
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

/** The RGB of one screen pixel, read from the canvas. */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.getByTestId('screen-canvas').evaluate(
    (canvas, [px, py]) => [...(canvas as HTMLCanvasElement).getContext('2d')!.getImageData(px, py, 1, 1).data.slice(0, 3)],
    [x, y]
  );
}

// The frame and PSET loop of the 1989 listings, in miniature.
const DRAWING = [
  '5 SCREEN 1,0: COLOR 0,0',
  '6 LINE (0,0)-(319,180),3,B',
  '10 FOR T = 0 TO 319',
  '20 PSET (T, 180 - T / 2), 2',
  '30 NEXT T',
].join('\n');

test('a program that draws shows its screen in the Plot pane', async ({ page }) => {
  await withListing(page, DRAWING);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });

  const canvas = page.getByTestId('screen-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('chart-empty')).toBeHidden();
  await expect(page.getByTestId('status'), 'the screen is its plot').toHaveText('');

  // COLOR 0,0 is palette 0 on black: colour 3 is brown, colour 2 red.
  await expect.poll(() => pixel(page, 0, 0)).toEqual([0xaa, 0x55, 0x00]);
  expect(await pixel(page, 100, 130)).toEqual([0xaa, 0x00, 0x00]);
  expect(await pixel(page, 100, 100)).toEqual([0, 0, 0]);

  // 320×200 filled a 4:3 monitor, so that is the shape it is shown at.
  const box = (await canvas.boundingBox())!;
  expect(Math.abs(box.width / box.height - 4 / 3)).toBeLessThan(0.02);
});

test('Continue carries on after END, as CONT did', async ({ page }) => {
  // Table 2 of the 1989 paper ENDs after its first run: "Then type CONT for run
  // with renewable resources."
  await withListing(page, '10 X = 1\n20 PRINT "FIRST"; X\n30 END\n40 X = X + 1\n50 PRINT "SECOND"; X');
  const output = page.getByTestId('console-output');
  const resume = page.getByTestId('continue');

  await expect(resume).toBeHidden();
  await page.getByTestId('run').click();
  await expect(output).toContainText('FIRST 1');
  await expect(resume).toBeVisible();
  await expect(page.getByTestId('status')).toContainText('stopped');
  await expect(output).not.toContainText('SECOND');

  await resume.click();
  await expect(output).toContainText('SECOND 2', { timeout: 15_000 });
  await expect(resume, 'it ran to the end: nothing is left to continue').toBeHidden();
  await expect(page.getByTestId('run')).toBeEnabled();
});

test('a new run starts with a clean screen, and the chart back', async ({ page }) => {
  await withListing(page, `${DRAWING}\n40 END\n50 PRINT "MORE"`);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('continue')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('screen-canvas')).toBeVisible();

  // Editing the program and running it again is a fresh start, not a CONT.
  const editor = page.getByTestId('editor-mount');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10 PRINT 0, 1\n20 PRINT 1, 2\n30 PRINT 2, 4');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });

  await expect(page.getByTestId('screen-canvas')).toBeHidden();
  await expect(page.getByTestId('chart-canvas')).toBeVisible();
  await expect(page.getByTestId('continue')).toBeHidden();
});
