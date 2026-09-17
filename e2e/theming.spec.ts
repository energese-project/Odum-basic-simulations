import { expect, test } from '@playwright/test';

/**
 * The palette is a two-repository contract (see src/styles/energese.css) and the
 * failure mode it guards against is silent: a hardcoded colour survives a theme
 * switch untouched and then glows white on a dark page. These assertions are
 * what catches that, because nothing about the rendering looks broken.
 */

test('the toggle switches themes and the tokens follow', async ({ page }) => {
  await page.goto('./');

  const ground = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--e-ground').trim()
    );

  const before = await ground();
  await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
  const after = await ground();

  expect(after).not.toBe(before);
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
});

test('an explicit choice survives a reload', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();

  await page.reload();
  // Set before first paint by the inline script in index.html, so there is no
  // light frame to catch on a dark-preferring machine.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('nothing on the page paints a hardcoded white or black', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  const offenders = await page.evaluate(() => {
    const bad = ['rgb(255, 255, 255)', 'rgb(0, 0, 0)'];
    const found: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      // A canvas is painted by Chart.js, not by CSS, and reports its own
      // backgroundColor as transparent — chart colours are covered below.
      if (el.tagName === 'CANVAS') continue;
      const s = getComputedStyle(el);
      if (bad.includes(s.backgroundColor) || bad.includes(s.color)) {
        found.push(`${el.tagName.toLowerCase()}.${el.className || '-'}`);
      }
    }
    return found;
  });

  expect(offenders, `elements painting pure white/black in dark mode: ${offenders.join(', ')}`)
    .toHaveLength(0);
});

test('the chart repaints itself when the theme changes', async ({ page }) => {
  await page.goto('./?prg=charge-discharge');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('chart-canvas')).toBeVisible();

  // A <canvas> is pixels: unlike the rest of the page it does not follow the
  // tokens on its own, so the theme-changed listener is the only thing keeping
  // it in the same palette as everything around it.
  const shot = () => page.getByTestId('chart-canvas').screenshot();
  const before = await shot();
  await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
  await expect
    .poll(async () => (await shot()).equals(before), {
      message: 'the chart canvas did not repaint after the theme changed',
      timeout: 5_000,
    })
    .toBe(false);
});
