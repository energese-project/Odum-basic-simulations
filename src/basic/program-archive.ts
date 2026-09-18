/**
 * Reading the `programs/` directory into a catalog.
 *
 * Node-only: this uses the filesystem and is imported by vite-plugin-programs.js
 * at build time and by the unit tests, never by the browser. It lives under
 * src/ rather than beside the plugin so that it is typechecked and tested like
 * everything else — the checks here are the ones a contributor's pull request
 * is judged by, and they deserve the same gate as the interpreter.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  DIAGRAM_EXTENSIONS,
  parseProgramMeta,
  type ProgramDiagram,
  type ProgramMeta,
  type ProgramSource,
} from './program-catalog.ts';

export const PROGRAMS_DIR = 'programs';

export interface CatalogEntry extends Omit<ProgramMeta, 'source' | 'diagram'> {
  /** null rather than absent: JSON.stringify drops undefined keys, and a
   *  missing key is indistinguishable from a bug on the reading side. */
  source: ProgramSource | null;
  diagram: ProgramDiagram | null;
  file: string;
  listing: string;
}

export interface Catalog {
  generated: string;
  programs: CatalogEntry[];
}

/** Files in programs/ that are documentation, not programs or metadata. */
const IGNORED = new Set(['index.json', 'README.md']);

export class ArchiveError extends Error {}

/** Big enough for a clean scan of a full-page figure; small enough that the
 *  library stays quick to browse on a phone. */
export const DIAGRAM_MAX_BYTES = 2 * 1024 * 1024;

const IMAGE_EXTENSION = new RegExp(`\\.(${DIAGRAM_EXTENSIONS.join('|')})$`);

/** What each extension's first bytes must be. A renamed HEIC or PDF passes
 *  every other check and then renders as a broken image on the site. */
const SIGNATURES: Record<string, { name: string; matches: (b: Buffer) => boolean }> = {
  png: { name: 'PNG', matches: (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  jpg: { name: 'JPEG', matches: (b) => b.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) },
  jpeg: { name: 'JPEG', matches: (b) => b.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) },
  webp: {
    name: 'WebP',
    matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
};

function checkDiagram(dir: string, file: string, images: string[]): void {
  if (!images.includes(file)) {
    throw new ArchiveError(`${PROGRAMS_DIR}/${file} is named in its sidecar but does not exist.`);
  }
  const path = join(dir, file);
  const size = statSync(path).size;
  if (size > DIAGRAM_MAX_BYTES) {
    throw new ArchiveError(
      `${PROGRAMS_DIR}/${file} is ${(size / 1024 / 1024).toFixed(1)} MB, over the 2 MB limit. ` +
        `Crop it to the figure, or save it as JPEG or WebP.`
    );
  }
  const ext = file.slice(file.lastIndexOf('.') + 1);
  const signature = SIGNATURES[ext];
  if (!signature.matches(readFileSync(path))) {
    throw new ArchiveError(
      `${PROGRAMS_DIR}/${file} is not a ${signature.name} file, whatever its extension says.`
    );
  }
}

/**
 * Build the catalog, or throw an ArchiveError naming exactly what is wrong.
 *
 * Every `.bas` must have a `.json` and every `.json` must have a `.bas`. Both
 * directions matter: a listing with no provenance looks authoritative and is
 * not, and a sidecar with no listing is usually a rename that only got half
 * done.
 */
export function readCatalog(root: string, now: Date = new Date()): Catalog {
  const dir = join(root, PROGRAMS_DIR);
  const files = readdirSync(dir).filter((f) => !IGNORED.has(f));

  const ids = files
    .filter((f) => f.endsWith('.bas'))
    .map((f) => f.slice(0, -'.bas'.length))
    .sort();

  const badNames = ids.filter((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id));
  if (badNames.length > 0) {
    // The id is a URL segment (?prg=...) and a filename on every OS a
    // contributor might use. Lowercase-kebab is the one form that is safe as
    // both and never collides on a case-insensitive filesystem.
    throw new ArchiveError(
      `Program filenames must be lowercase-kebab-case: ${badNames
        .map((id) => `${PROGRAMS_DIR}/${id}.bas`)
        .join(', ')}.`
    );
  }

  const missing = ids.filter((id) => !files.includes(`${id}.json`));
  if (missing.length > 0) {
    throw new ArchiveError(
      `Program(s) with no metadata sidecar: ${missing
        .map((id) => `${PROGRAMS_DIR}/${id}.bas`)
        .join(', ')}.\n` +
        `Every listing needs a ${PROGRAMS_DIR}/<id>.json saying where it came from — ` +
        `see ${PROGRAMS_DIR}/README.md.`
    );
  }

  const orphans = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .filter((id) => !ids.includes(id));
  if (orphans.length > 0) {
    throw new ArchiveError(
      `Metadata with no program: ${orphans.map((id) => `${PROGRAMS_DIR}/${id}.json`).join(', ')}. ` +
        `Was the .bas renamed without its sidecar?`
    );
  }

  const images = files.filter((f) => IMAGE_EXTENSION.test(f));
  const stray = files.filter(
    (f) => !f.endsWith('.bas') && !f.endsWith('.json') && !images.includes(f)
  );
  if (stray.length > 0) {
    throw new ArchiveError(
      `Unexpected file(s) in ${PROGRAMS_DIR}/: ${stray.join(', ')}. ` +
        `Only <id>.bas, <id>.json and a declared diagram belong here — ` +
        `notes and page photos go in the pull request.`
    );
  }

  const programs = ids.map((id): CatalogEntry => {
    const meta = parseProgramMeta(id, readFileSync(join(dir, `${id}.json`), 'utf8'));
    const listing = readFileSync(join(dir, `${id}.bas`), 'utf8');
    if (listing.trim() === '') {
      throw new ArchiveError(`${PROGRAMS_DIR}/${id}.bas is empty.`);
    }
    if (meta.diagram) checkDiagram(dir, meta.diagram.file, images);
    return {
      ...meta,
      source: meta.source ?? null,
      diagram: meta.diagram ?? null,
      file: `${id}.bas`,
      listing,
    };
  });

  // Every image must be claimed by a sidecar, because the sidecar is where its
  // rights are recorded. An unclaimed image is one nobody has said may be here.
  const declared = new Set(programs.map((p) => p.diagram?.file).filter(Boolean));
  const undeclared = images.filter((f) => !declared.has(f));
  if (undeclared.length > 0) {
    throw new ArchiveError(
      `Image(s) not declared by any sidecar: ${undeclared
        .map((f) => `${PROGRAMS_DIR}/${f}`)
        .join(', ')}. A diagram is published only when its program's .json names it ` +
        `under "diagram", with the rights it is reproduced under — see ${PROGRAMS_DIR}/README.md.`
    );
  }

  return { generated: now.toISOString(), programs };
}
