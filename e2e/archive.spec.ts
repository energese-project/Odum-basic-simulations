import { expect, test } from '@playwright/test';

/**
 * The archive is the reason this repository exists: a listing is only useful
 * for checking Odum's work if you can see where it came from and fetch the file
 * itself. These tests are about the published artifact, not the UI chrome —
 * they assert that the catalog and the raw files are actually reachable at the
 * URLs the citations point at.
 */

test('the catalog is published and carries provenance for every program', async ({ request }) => {
  const response = await request.get('./programs/index.json');
  expect(response.ok()).toBeTruthy();

  const catalog = await response.json();
  expect(catalog.programs.length).toBeGreaterThan(0);

  for (const program of catalog.programs) {
    // Validation runs at build time, so a failure here means the build emitted
    // something the validator never saw.
    expect(program.id, 'every program has an id').toBeTruthy();
    expect(program.listing, `${program.id} carries its listing`).toContain('PRINT');
    expect(
      ['verbatim', 'corrected', 'adapted', 'original'],
      `${program.id} declares a fidelity`
    ).toContain(program.fidelity);
    if (program.fidelity !== 'original') {
      expect(program.source, `${program.id} is cited`).toBeTruthy();
    }
  }
});

test('every listing is published as a real file at the URL its citation uses', async ({
  request,
}) => {
  const catalog = await (await request.get('./programs/index.json')).json();

  for (const program of catalog.programs) {
    const file = await request.get(`./programs/${program.file}`);
    expect(file.ok(), `${program.file} is fetchable`).toBeTruthy();
    // The published file and the catalog copy must not drift: a reader who
    // downloads the .bas should get exactly what the app just ran.
    expect(await file.text()).toBe(program.listing);
  }
});

test('every declared diagram is published as an image at the URL its program uses', async ({
  request,
}) => {
  const catalog = await (await request.get('./programs/index.json')).json();
  const withDiagrams = catalog.programs.filter((p: { diagram: unknown }) => p.diagram);
  expect(withDiagrams.length, 'at least one program carries a diagram').toBeGreaterThan(0);

  for (const program of withDiagrams) {
    const image = await request.get(`./programs/${program.diagram.file}`);
    expect(image.ok(), `${program.diagram.file} is fetchable`).toBeTruthy();
    expect(image.headers()['content-type']).toMatch(/^image\//);
  }
});

test('the sidecars are published too, so the metadata is citable on its own', async ({
  request,
}) => {
  const response = await request.get('./programs/charge-discharge.json');
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).fidelity).toBeTruthy();
});

// The explorer ---------------------------------------------------------------
//
// The provenance is the sidecar itself, not a panel that paraphrases it: every
// published file of the current program is in the explorer, and a text file
// opens in the editor exactly as it is published.

test('the explorer lists the program\'s published files', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  const files = page.getByTestId('file-list');
  await expect(files.getByRole('button', { name: 'charge-discharge.bas' })).toHaveAttribute(
    'aria-current',
    'true'
  );
  await expect(files.getByRole('button', { name: 'charge-discharge.json' })).toBeVisible();

  // An image is not text, so it is not opened in the editor: it is a link to
  // the published file, full size, which is how a scan is checked.
  const image = files.getByRole('link', { name: /charge-discharge\.png/ });
  await expect(image).toHaveAttribute('href', /programs\/charge-discharge\.png$/);
  await expect(image).toHaveAttribute('target', '_blank');
});

test('the sidecar opens in the editor as published, and cannot be typed over', async ({
  page,
}) => {
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('editor-mount')).toContainText('PRINT');

  await page.getByTestId('file-list').getByRole('button', { name: 'charge-discharge.json' }).click();
  await expect(page).toHaveURL(/\?prg=charge-discharge&file=charge-discharge\.json$/);
  await expect(page.getByTestId('editor-filename')).toHaveText('charge-discharge.json');
  const mount = page.getByTestId('editor-mount');
  await expect(mount).toContainText('"fidelity"');

  // Read-only: there is nowhere to save it, and an edited sidecar on screen
  // would misstate what the archive says.
  await mount.click();
  await page.keyboard.type('XYZZY');
  await expect(mount).not.toContainText('XYZZY');
  await expect(mount).toContainText('Charge And Discharge');
});

test('a link to a program\'s file opens that file', async ({ page }) => {
  await page.goto('./?prg=charge-discharge&file=charge-discharge.json');
  await expect(page.getByTestId('editor-filename')).toHaveText('charge-discharge.json');
  await expect(page.getByTestId('editor-mount')).toContainText('"fidelity"');
});

test('an edited listing survives a look at the sidecar, and is what runs', async ({ page }) => {
  await page.goto('./?prg=hello');
  const mount = page.getByTestId('editor-mount');
  await expect(mount).toContainText('PRINT');
  await mount.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('10 PRINT "EDITED"\n20 END');

  const files = page.getByTestId('file-list');
  await files.getByRole('button', { name: 'hello.json' }).click();
  await expect(mount).toContainText('"fidelity"');

  // Run acts on the program, not on whichever file happens to be open.
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('console-output')).toContainText('EDITED');

  await files.getByRole('button', { name: 'hello.bas' }).click();
  await expect(mount).toContainText('EDITED');
});

test('the explorer follows the program', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await page.getByTestId('library-list').getByRole('button', { name: /^Two Tanks/ }).click();
  const files = page.getByTestId('file-list');
  await expect(files.getByRole('button', { name: 'two-tank.bas' })).toBeVisible();
  await expect(files.getByRole('button', { name: 'two-tank.json' })).toBeVisible();
  await expect(files.getByRole('button', { name: 'charge-discharge.bas' })).toHaveCount(0);
  await expect(files.getByRole('link')).toHaveCount(0);
});
