import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import programs from './vite-plugin-programs.js';

// This is a PROJECT Pages site — https://energese-project.github.io/Odum-basic-simulations/ —
// not an organisation site at the domain root, so `base` is the repository path.
//
// Not './'. A relative base makes import.meta.env.BASE_URL the string './', which
// is useless to the router: Boba needs a real prefix to strip off window.location
// .pathname before matching a route. With an explicit base, the dev server serves
// under the same prefix as production, BASE_URL is one value in both, and
// src/main.ts can hand it straight to window.BOBA_BASE_URL with nothing hardcoded
// a second time.
export default defineConfig({
  base: '/Odum-basic-simulations/',
  plugins: [tailwindcss(), programs()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  // Monaco is thousands of small ES modules. Left to discover them at request
  // time, the dev server serves them one by one, then hits an import it has not
  // seen, re-runs dependency optimization and forces a full page reload — which
  // in a test run looks like the page dying mid-assertion. Naming the entry here
  // makes esbuild pre-bundle it once at startup instead.
  optimizeDeps: {
    include: ['monaco-editor/editor/editor.api.js'],
  },

  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
