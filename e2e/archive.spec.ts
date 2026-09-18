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

test('the sidecars are published too, so the metadata is citable on its own', async ({
  request,
}) => {
  const response = await request.get('./programs/charge-discharge.json');
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).fidelity).toBeTruthy();
});

test('the provenance panel states fidelity and links to the listing', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');

  const badge = page.getByTestId('fidelity-badge');
  await expect(badge).toHaveText('original');
  await expect(page.getByTestId('citation')).toContainText('Not from a published listing');
  await expect(page.getByTestId('meta-notes')).toContainText('first mini-model');

  const raw = page.getByTestId('meta-links').getByRole('link', { name: /charge-discharge\.bas/ });
  await expect(raw).toHaveAttribute('href', /programs\/charge-discharge\.bas$/);
  await expect(
    page.getByTestId('meta-links').getByRole('link', { name: 'History on GitHub' })
  ).toHaveAttribute('href', /github\.com.*commits\/main\/programs\/charge-discharge\.bas/);
});

test('the notes line is hidden when a program has nothing to add', async ({ page }) => {
  // An empty notes paragraph would still take up a row and read as missing data.
  await page.goto('./?prg=two-tank');
  await expect(page.getByTestId('fidelity-badge')).toHaveText('original');
  await expect(page.getByTestId('meta-notes')).toBeHidden();
});

test('the provenance panel follows the program picker', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await expect(page.getByTestId('meta-links').getByRole('link').first()).toContainText(
    'charge-discharge.bas'
  );

  await page.getByTestId('program-select').selectOption('two-tank');
  await expect(page.getByTestId('meta-links').getByRole('link').first()).toContainText(
    'two-tank.bas'
  );
});
