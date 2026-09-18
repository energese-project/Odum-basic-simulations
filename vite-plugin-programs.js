import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROGRAMS_DIR, readCatalog } from './src/basic/program-archive.ts';

/**
 * Serves and publishes the program archive in `programs/`.
 *
 * The listings live at the repository root, not under `src/`, because they are
 * the point of the repository rather than part of the application. Someone
 * arriving to check a model against its source should find them immediately,
 * and should be able to read a `.bas` on GitHub without knowing what Vite is.
 *
 * That puts them outside both `src/` and `public/`, so this plugin:
 *
 *   1. builds `programs/index.json` — the whole catalog, listings inline — so
 *      the browser gets the library in one fetch;
 *   2. serves that index and reloads the page when a program changes in dev;
 *   3. copies every raw `.bas` and `.json` into `dist/`, so each published
 *      program has a real URL its citation can point at.
 *
 * All the rules about what a valid archive is live in
 * src/basic/program-archive.ts, where they are typechecked and unit-tested.
 * This file is glue and should stay that way.
 */

const INDEX = `${PROGRAMS_DIR}/index.json`;

export default function programsPlugin() {
  let root = process.cwd();

  return {
    name: 'odum-programs',

    configResolved(config) {
      root = config.root;
    },

    // Fail early and loudly: a broken sidecar should stop the dev server or the
    // build with the filename and the field, not render an empty program picker
    // that looks like a bug in the application.
    buildStart() {
      readCatalog(root);
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (!path.endsWith(`/${INDEX}`)) return next();
        try {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(readCatalog(root)));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });

      // Vite only watches its own module graph; programs/ is outside it.
      server.watcher.add(join(root, PROGRAMS_DIR));
      server.watcher.on('all', (_event, file) => {
        if (file.includes(`${PROGRAMS_DIR}/`) && /\.(bas|json)$/.test(file)) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },

    generateBundle() {
      const catalog = readCatalog(root);
      this.emitFile({ type: 'asset', fileName: INDEX, source: JSON.stringify(catalog) });

      // The raw files as well as the index: a citation that says "this listing"
      // should link to the listing, not to a JSON blob that contains it.
      for (const program of catalog.programs) {
        this.emitFile({
          type: 'asset',
          fileName: `${PROGRAMS_DIR}/${program.file}`,
          source: program.listing,
        });
        this.emitFile({
          type: 'asset',
          fileName: `${PROGRAMS_DIR}/${program.id}.json`,
          source: readFileSync(join(root, PROGRAMS_DIR, `${program.id}.json`), 'utf8'),
        });
      }
    },
  };
}
