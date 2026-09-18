import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * "My programs": a reader's own programs, kept in the browser's Origin Private
 * File System, beside the read-only archive. A program is written here, checked
 * against the same rules the build uses, and handed to the "Add a program"
 * form on GitHub with everything already filled in.
 *
 * Each Playwright test gets a fresh browser context, so a fresh, empty OPFS.
 */

const DIAGRAM = readFileSync('programs/charge-discharge.png');

async function newProgram(page: Page): Promise<void> {
  await page.getByTestId('workspace-new').click();
  await expect(page).toHaveURL(/\?my=untitled$/);
  await expect(page.getByTestId('editor-mount')).toContainText('10 REM Untitled');
}

async function complete(page: Page): Promise<void> {
  await page.getByTestId('form-title').fill('Mini Tank');
  await page.getByTestId('form-description').fill('One storage, filled and drained.');
  await page.getByTestId('form-fidelity').selectOption('original');
}

test('a new program opens in the editor and is still there after a reload', async ({ page }) => {
  await page.goto('./');
  await newProgram(page);

  const mine = page.getByTestId('workspace-list');
  await expect(mine.getByRole('button', { name: /Untitled/ })).toHaveAttribute('aria-current', 'true');
  await expect(mine.getByRole('button', { name: 'untitled.bas' })).toBeVisible();
  await expect(mine.getByRole('button', { name: 'untitled.json' })).toBeVisible();

  const editor = page.getByTestId('editor-mount');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10 PRINT "SAVED"\n20 END');
  // Saved as it is typed; give the debounce a moment, then prove it from disk.
  await expect.poll(() => readWorkspaceFile(page, 'untitled.bas')).toContain('SAVED');

  await page.reload();
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT "SAVED"');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('console-output')).toContainText('SAVED');
});

test('the details of your own program are a form, checked as you type', async ({ page }) => {
  await page.goto('./');
  await newProgram(page);

  const problems = page.getByTestId('form-problems');
  await expect(problems).toContainText('Description is required');
  await expect(problems).toContainText('Fidelity is required');
  await expect(page.getByTestId('form-submit')).toBeDisabled();

  await complete(page);
  await expect(problems).toBeHidden();
  await expect(page.getByTestId('form-submit')).toBeEnabled();

  // The build's own rules, not a second copy: verbatim needs a source.
  await page.getByTestId('form-fidelity').selectOption('verbatim');
  await expect(problems).toContainText('"source" is required');

  await expect.poll(async () => JSON.parse(await readWorkspaceFile(page, 'untitled.json')).title)
    .toBe('Mini Tank');
});

test('changing the program id renames its files', async ({ page }) => {
  await page.goto('./');
  await newProgram(page);

  await page.getByTestId('form-id').fill('mini-tank');
  await page.getByTestId('form-id').press('Enter');

  await expect(page).toHaveURL(/\?my=mini-tank$/);
  await expect(page.getByTestId('workspace-list').getByRole('button', { name: 'mini-tank.bas' })).toBeVisible();

  // An id already in the archive is refused, and nothing is renamed.
  await page.getByTestId('form-id').fill('two-tank');
  await page.getByTestId('form-id').press('Enter');
  await expect(page.getByTestId('form-id-error')).toContainText('already in the archive');
  await expect(page).toHaveURL(/\?my=mini-tank$/);
});

test('a diagram can be attached, and shows above the plot', async ({ page }) => {
  await page.goto('./');
  await newProgram(page);

  await page.getByTestId('form-diagram-file').setInputFiles({
    name: 'figure.png',
    mimeType: 'image/png',
    buffer: DIAGRAM,
  });

  await expect(page.getByTestId('workspace-list').getByRole('button', { name: 'untitled.png' })).toBeVisible();
  const image = page.getByTestId('diagram-pane').getByRole('img');
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  // An image needs its rights recorded before it can be submitted.
  await complete(page);
  await expect(page.getByTestId('form-problems')).toContainText('diagram');
});

test('an archive program can be copied into My programs, without its fidelity', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await page.getByTestId('copy-to-workspace').click();

  await expect(page).toHaveURL(/\?my=charge-discharge-copy$/);
  await expect(page.getByTestId('editor-mount')).toContainText('REM Charge And Discharge');
  await expect(page.getByTestId('form-fidelity')).toHaveValue('');
  await expect(page.getByTestId('form-notes')).toHaveValue(/Copied from the archive's charge-discharge/);
  await expect(page.getByTestId('diagram-pane')).toBeVisible();
  await expect(
    page.getByTestId('workspace-list').getByRole('button', { name: 'charge-discharge-copy.png' })
  ).toBeVisible();
});

test('submitting opens the form on GitHub with the program already filled in', async ({ page }) => {
  await page.goto('./');
  await newProgram(page);
  await complete(page);
  await page.getByTestId('form-diagram-file').setInputFiles({
    name: 'figure.png',
    mimeType: 'image/png',
    buffer: DIAGRAM,
  });
  await page.getByTestId('form-diagram-caption').fill('A tank.');
  await page.getByTestId('form-rights-basis').selectOption('own-work');
  await page.getByTestId('form-rights-statement').fill('Drawn for this archive.');
  await expect(page.getByTestId('form-submit')).toBeEnabled();

  await page.getByTestId('form-submit').click();
  const dialog = page.getByTestId('submit-dialog');
  await expect(dialog).toBeVisible();

  const href = await dialog.getByRole('link', { name: /Open the form on GitHub/ }).getAttribute('href');
  const url = new URL(href!);
  expect(url.pathname).toBe('/energese-project/Odum-basic-simulations/issues/new');
  expect(url.searchParams.get('template')).toBe('add-program.yml');
  expect(url.searchParams.get('program_title')).toBe('Mini Tank');
  expect(url.searchParams.get('listing')).toContain('10 REM Untitled');

  // GitHub cannot prefill an attachment, so the diagram is handed over as a
  // download, to be dragged into the form.
  const download = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /untitled\.png/ }).click();
  expect((await download).suggestedFilename()).toBe('untitled.png');

  // Dropdowns may not prefill, so the choices to make are spelled out.
  await expect(dialog).toContainText('Fidelity: original');
});

test('a program can be downloaded as the files the archive would hold', async ({ page }) => {
  await page.goto('./');
  await newProgram(page);
  const download = page.waitForEvent('download');
  await page.getByTestId('form-download').click();
  expect((await download).suggestedFilename()).toBe('untitled.bas');
});

test('a program can be deleted', async ({ page }) => {
  await page.goto('./');
  await newProgram(page);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('form-delete').click();

  await expect(page.getByTestId('workspace-list').getByRole('button')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\?my=/);
});

test('without a private file system the archive still works, and says why My programs is empty', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error — simulating a browser without OPFS
    delete StorageManager.prototype.getDirectory;
  });
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');
  await expect(page.getByTestId('workspace-unavailable')).toBeVisible();
  await expect(page.getByTestId('workspace-new')).toBeHidden();
});

test('files are written through a worker where createWritable is missing, as in older Safari', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error — simulating a browser that only has sync access handles
    delete FileSystemFileHandle.prototype.createWritable;
  });
  await page.goto('./');
  await newProgram(page);
  await page.getByTestId('form-title').fill('Written By Worker');
  await expect.poll(async () => {
    const text = await readWorkspaceFile(page, 'untitled.json');
    return text ? JSON.parse(text).title : null;
  }).toBe('Written By Worker');

  await page.reload();
  await expect(page.getByTestId('form-title')).toHaveValue('Written By Worker');
});

/** Read a file straight from OPFS, so a test proves what was stored, not what is on screen. */
async function readWorkspaceFile(page: Page, name: string): Promise<string> {
  return page.evaluate(async (file) => {
    try {
      const root = await navigator.storage.getDirectory();
      const app = await root.getDirectoryHandle('odum-basic-simulations');
      const dir = await app.getDirectoryHandle('workspace');
      return await (await (await dir.getFileHandle(file)).getFile()).text();
    } catch {
      return '';
    }
  }, name);
}
