import { defineConfig, devices } from '@playwright/test';

// Both servers are mounted under the Vite base, so baseURL carries it and the
// specs can navigate to '/' and mean the app root. See vite.config.js.
const BASE = '/Odum-basic-simulations/';
const PRODUCTION = `http://localhost:4173${BASE}`;

// The figures are pixel goldens, meaningful only in the environment that made
// them. See e2e/figures.spec.ts.
const FIGURES = /figures\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'dev',
      testIgnore: FIGURES,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:5173${BASE}` },
    },
    // The same suite against the built bundle. The interpreter runs in a Web
    // Worker loaded through `new URL(..., import.meta.url)`, which Vite resolves
    // differently in dev (a module URL) and in a build (a hashed asset). A suite
    // that only ran against the dev server would not test the thing that ships.
    {
      name: 'production',
      testIgnore: FIGURES,
      use: { ...devices['Desktop Chrome'], baseURL: PRODUCTION },
    },
    // The paper's figures, captured from the build that ships and compared
    // against the committed goldens that docs/article.tex includes. One file per
    // figure, no platform or project suffix, because the article names them.
    {
      name: 'figures',
      testMatch: FIGURES,
      snapshotPathTemplate: '{testDir}/figures/{arg}{ext}',
      // `scale: 'device'` keeps the 2x pixels; the default ('css') would
      // capture at 1x whatever deviceScaleFactor says, too coarse for print.
      //
      // `maxDiffPixels` absorbs anti-aliasing noise, not change. The same commit
      // has rendered the editor's keyword glyphs 30 device pixels apart between
      // two runs in the same image (PR #43), invisible side by side, and failed
      // all three retries of one run. 60 is twice that, about a thousandth of a
      // percent of the 2880x1800 workbench figure; a real change to the layout, a
      // colour or even one word moves hundreds of pixels or more.
      expect: {
        toHaveScreenshot: { scale: 'device', stylePath: 'e2e/figures.css', maxDiffPixels: 60 },
      },
      use: {
        ...devices['Desktop Chrome'],
        baseURL: PRODUCTION,
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: 'light',
      },
    },
  ],
  webServer: [
    {
      command: 'npx vite',
      url: `http://localhost:5173${BASE}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run build && npm run preview',
      url: `http://localhost:4173${BASE}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
