/**
 * Reading the `programs/` directory into a catalog.
 *
 * Node-only: this uses the filesystem and is imported by vite-plugin-programs.js
 * at build time and by the unit tests, never by the browser. It lives under
 * src/ rather than beside the plugin so that it is typechecked and tested like
 * everything else — the checks here are the ones a contributor's pull request
 * is judged by, and they deserve the same gate as the interpreter.
 */

import { readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

import { IMAGE_FORMAT_NAME, sniffImage, type ImageFormat } from './image-format.ts';
import {
  DIAGRAM_EXTENSIONS,
  parseProgramMeta,
  type ProgramDiagram,
  type ProgramMeta,
  type ProgramSource,
} from './program-catalog.ts';
import {
  WORK_NAME,
  applyRun,
  checkWorkName,
  parseModelMeta,
  parseRun,
  parseWorkSource,
  type ProgramCrop,
  type RunMeta,
  type WorkSource,
} from './work-catalog.ts';

export const PROGRAMS_DIR = 'programs';

export interface CatalogEntry extends Omit<ProgramMeta, 'source' | 'diagram'> {
  /** null rather than absent: JSON.stringify drops undefined keys, and a
   *  missing key is indistinguishable from a bug on the reading side. */
  source: ProgramSource | null;
  diagram: ProgramDiagram | null;
  file: string;
  listing: string;
  /** The metadata's path within programs/: `<id>.json`, or a model's meta-data.json. */
  sidecar: string;
  /** The work a model belongs to, and its source.json; null for a single program. */
  work: { id: string; file: string } | null;
  /** The listing as printed, cropped from the page. Works only. */
  programImage: (ProgramCrop & { file: string }) | null;
  /** The published figures, each drawn by one run of the listing. Works only. */
  runs: CatalogRun[];
}

export interface CatalogRun extends RunMeta {
  /** The file name without .json, e.g. "fig5". */
  id: string;
  file: string;
  /** The published figure, cropped from the page, if it has been. */
  plot: string | null;
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

function checkDiagram(dir: string, file: string, images: string[]): void {
  if (!images.includes(file)) {
    throw new ArchiveError(`${PROGRAMS_DIR}/${file} is named in its sidecar but does not exist.`);
  }
  checkImage(dir, file);
}

/** Within the size limit, and really the format its extension says. */
function checkImage(dir: string, file: string): void {
  const path = join(dir, file);
  const size = statSync(path).size;
  if (size > DIAGRAM_MAX_BYTES) {
    throw new ArchiveError(
      `${PROGRAMS_DIR}/${file} is ${(size / 1024 / 1024).toFixed(1)} MB, over the 2 MB limit. ` +
        `Crop it to the figure, or save it as JPEG or WebP.`
    );
  }
  const ext = file.slice(file.lastIndexOf('.') + 1);
  const expected: ImageFormat = ext === 'jpeg' ? 'jpg' : (ext as ImageFormat);
  if (sniffImage(readFileSync(path)) !== expected) {
    throw new ArchiveError(
      `${PROGRAMS_DIR}/${file} is not a ${IMAGE_FORMAT_NAME[expected]} file, whatever its extension says.`
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
  refuseDocuments(dir);

  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => !IGNORED.has(e.name));
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  const misnamed = folders.filter((f) => !WORK_NAME.test(f));
  if (misnamed.length > 0) {
    throw new ArchiveError(
      `Folder(s) not named like a work: ${misnamed.map((f) => `${PROGRAMS_DIR}/${f}/`).join(', ')}. ` +
        `A folder in ${PROGRAMS_DIR}/ is one publication, named author_title_year — ` +
        `e.g. odum_simulation_1989 — see ${PROGRAMS_DIR}/README.md.`
    );
  }

  const programs = [...readSinglePrograms(dir, files), ...folders.flatMap((work) => readWork(dir, work))];
  programs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { generated: now.toISOString(), programs };
}

/**
 * Every file the catalog refers to, as a path within programs/: what the build
 * publishes. Nothing else in programs/ is published, and readCatalog has
 * already refused anything that is neither referred to nor documentation.
 */
export function publishedFiles(catalog: Catalog): string[] {
  const files = new Set<string>();
  for (const p of catalog.programs) {
    files.add(p.file);
    files.add(p.sidecar);
    if (p.work) files.add(p.work.file);
    if (p.diagram) files.add(p.diagram.file);
    if (p.programImage) files.add(p.programImage.file);
    for (const run of p.runs) {
      files.add(run.file);
      if (run.plot) files.add(run.plot);
    }
  }
  return [...files].sort();
}

/**
 * The article a model was cut from is the natural thing to leave beside it,
 * and the one thing that must never be published: it is someone else's
 * copyright, and programs/ is published as it stands.
 */
function refuseDocuments(dir: string, prefix = ''): void {
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) refuseDocuments(dir, path);
    else if (/\.pdf$/i.test(entry.name)) {
      throw new ArchiveError(
        `${PROGRAMS_DIR}/${path}: an article or book is never published here. It is someone ` +
          `else's copyright, and ${PROGRAMS_DIR}/ is published as it stands. Keep it outside the ` +
          `repository; only the crops of its listing, diagram and figures belong in the work's folder.`
      );
    }
  }
}

/** `<id>.bas` and `<id>.json` at the top of programs/, with an optional diagram. */
function readSinglePrograms(dir: string, files: string[]): CatalogEntry[] {
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
      sidecar: `${id}.json`,
      work: null,
      programImage: null,
      runs: [],
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

  return programs;
}

// Works ----------------------------------------------------------------------
//
// programs/<author_title_year>/<model>/ — see work-catalog.ts for the layout and
// why it follows the publication rather than the program.

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CROPS = ['program', 'diagram'] as const;

function list(dir: string, path: string): { files: string[]; folders: string[] } {
  const entries: Dirent[] = readdirSync(join(dir, path), { withFileTypes: true });
  return {
    files: entries.filter((e) => e.isFile()).map((e) => e.name).sort(),
    folders: entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(),
  };
}

function refuseStray(path: string, stray: string[], allowed: string): void {
  if (stray.length === 0) return;
  throw new ArchiveError(
    `Unexpected file(s) in ${PROGRAMS_DIR}/${path}/: ${stray.join(', ')}. ` +
      `Only ${allowed} belong here — notes and page photos go in the pull request.`
  );
}

function refuseMisnamed(path: string, names: string[], what: string): void {
  const bad = names.filter((n) => !KEBAB.test(n));
  if (bad.length === 0) return;
  throw new ArchiveError(
    `${what} must be lowercase-kebab-case, like program ids: ` +
      `${bad.map((n) => `${PROGRAMS_DIR}/${path}/${n}`).join(', ')}.`
  );
}

function readWork(dir: string, work: string): CatalogEntry[] {
  const { files, folders } = list(dir, work);
  if (!files.includes('source.json')) {
    throw new ArchiveError(
      `${PROGRAMS_DIR}/${work}/source.json is missing. A work states its citation, and the ` +
        `rights its crops are published under, once for all of its models.`
    );
  }
  refuseStray(work, files.filter((f) => f !== 'source.json'), 'source.json and one folder per model');

  const source = parseWorkSource(work, readFileSync(join(dir, work, 'source.json'), 'utf8'));
  checkWorkName(work, source.source);

  if (folders.length === 0) {
    throw new ArchiveError(
      `${PROGRAMS_DIR}/${work} has no model. Each listing goes in a folder of its own: ` +
        `${PROGRAMS_DIR}/${work}/<model>/model.bas and meta-data.json.`
    );
  }
  refuseMisnamed(work, folders, 'Model folders');
  return folders.map((model) => readModel(dir, work, model, source));
}

/** The single image for one crop — `diagram.png` or `diagram.jpg`, not both. */
function cropImage(path: string, files: string[], crop: string): string | null {
  const found = files.filter((f) => new RegExp(`^${crop}\\.(${DIAGRAM_EXTENSIONS.join('|')})$`).test(f));
  if (found.length > 1) {
    throw new ArchiveError(
      `${PROGRAMS_DIR}/${path} has ${found.join(' and ')}: one image per crop, or which is it?`
    );
  }
  return found[0] ?? null;
}

function readModel(dir: string, work: string, model: string, source: WorkSource): CatalogEntry {
  const path = `${work}/${model}`;
  const { files, folders } = list(dir, path);

  for (const required of ['model.bas', 'meta-data.json']) {
    if (!files.includes(required)) {
      throw new ArchiveError(
        `${PROGRAMS_DIR}/${path}/${required} is missing: a model is its listing, model.bas, ` +
          `and what it is, meta-data.json.`
      );
    }
  }

  const images = Object.fromEntries(CROPS.map((crop) => [crop, cropImage(path, files, crop)]));
  const known = new Set(['model.bas', 'meta-data.json', ...Object.values(images).filter((f) => f !== null)]);
  refuseStray(
    path,
    files.filter((f) => !known.has(f)),
    'model.bas, meta-data.json, program and diagram images, and a runs/ folder'
  );
  refuseStray(path, folders.filter((f) => f !== 'runs').map((f) => `${f}/`), 'files and a runs/ folder');

  const meta = parseModelMeta(`${path}/meta-data.json`, readFileSync(join(dir, path, 'meta-data.json'), 'utf8'));
  const listing = readFileSync(join(dir, path, 'model.bas'), 'utf8');
  if (listing.trim() === '') throw new ArchiveError(`${PROGRAMS_DIR}/${path}/model.bas is empty.`);

  // A crop and its description arrive together or not at all: an image nobody
  // has described has no alt text, and a description of nothing is a crop
  // someone forgot to add.
  for (const crop of CROPS) {
    const image = images[crop];
    if (image && !meta[crop]) {
      throw new ArchiveError(
        `${PROGRAMS_DIR}/${path}/${image} has no "${crop}" in meta-data.json to describe it. ` +
          `Every crop needs a caption: it is the image's alt text.`
      );
    }
    if (!image && meta[crop]) {
      throw new ArchiveError(
        `${PROGRAMS_DIR}/${path}/meta-data.json describes a "${crop}" but there is no ${crop} ` +
          `image (${crop}.${DIAGRAM_EXTENSIONS.join(`, ${crop}.`)}) beside it.`
      );
    }
    if (image) checkImage(dir, `${path}/${image}`);
  }

  const diagram: ProgramDiagram | null =
    meta.diagram && images.diagram
      ? { file: `${path}/${images.diagram}`, ...meta.diagram, rights: source.rights }
      : null;

  return {
    id: path,
    title: meta.title,
    description: meta.description,
    fidelity: meta.fidelity,
    ...(meta.notes ? { notes: meta.notes } : {}),
    tags: meta.tags,
    source: source.source,
    diagram,
    file: `${path}/model.bas`,
    listing,
    sidecar: `${path}/meta-data.json`,
    work: { id: work, file: `${work}/source.json` },
    programImage: meta.program && images.program ? { file: `${path}/${images.program}`, ...meta.program } : null,
    runs: folders.includes('runs') ? readRuns(dir, `${path}/runs`, listing) : [],
  };
}

function readRuns(dir: string, path: string, listing: string): CatalogRun[] {
  const { files, folders } = list(dir, path);
  refuseStray(path, folders.map((f) => `${f}/`), '<run>.json and its plot');

  const ids = files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
  refuseMisnamed(path, ids, 'Run names');

  const plots = files.filter((f) => IMAGE_EXTENSION.test(f));
  refuseStray(path, files.filter((f) => !f.endsWith('.json') && !plots.includes(f)), '<run>.json and its plot');
  for (const plot of plots) {
    const id = plot.slice(0, plot.lastIndexOf('.'));
    if (!ids.includes(id)) {
      throw new ArchiveError(
        `${PROGRAMS_DIR}/${path}/${plot} has no ${id}.json to say which figure it is, ` +
          `and what the run that draws it changes.`
      );
    }
  }

  return ids.map((id): CatalogRun => {
    const file = `${path}/${id}.json`;
    const run = parseRun(file, readFileSync(join(dir, file), 'utf8'));
    try {
      applyRun(listing, run.changes);
    } catch (e) {
      throw new ArchiveError(`${PROGRAMS_DIR}/${file}: ${e instanceof Error ? e.message : String(e)}.`);
    }
    const plot = cropImage(path, files, id);
    if (plot) checkImage(dir, `${path}/${plot}`);
    return { id, file, plot: plot ? `${path}/${plot}` : null, ...run };
  });
}
