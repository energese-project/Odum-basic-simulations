import { defineConfig, devices } from '@playwright/test';

// Both servers are mounted under the Vite base, so baseURL carries it and the
// specs can navigate to '/' and mean the app root. See vite.config.js.
const BASE = '/Odum-basic-simulations/';

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
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:5173${BASE}` },
    },
    // The same suite against the built bundle. The interpreter runs in a Web
    // Worker loaded through `new URL(..., import.meta.url)`, which Vite resolves
    // differently in dev (a module URL) and in a build (a hashed asset). A suite
    // that only ran against the dev server would not test the thing that ships.
    {
      name: 'production',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:4173${BASE}` },
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
