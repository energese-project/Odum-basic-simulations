/**
 * The rules for a published work: `programs/<author_title_year>/`.
 *
 * A single program is one listing with a sidecar. A work is what a book or an
 * article actually is — one citation, and inside it several models, each with
 * its printed listing and diagram, and each run several times for the figures
 * the text discusses. Odum's 1989 paper in Simulation prints two listings and
 * seven plots from them. The layout follows the publication:
 *
 *   programs/odum_simulation_1989/
 *     source.json                 the citation, and the rights its crops are under
 *     macroeconomics/             one folder per model
 *       model.bas                 the listing
 *       meta-data.json            fidelity, and what each crop shows
 *       program.png diagram.png   the listing and the diagram, cropped from the page
 *       runs/fig3a.json           one published figure: which, and what it changes
 *       runs/fig3a.png            that figure, cropped from the page
 *
 * The point of the crops is that anyone can check two things against the page:
 * that the listing is what was printed, and whether it draws what was printed.
 *
 * Pure, like program-catalog.ts: strings in, values or a MetadataError out.
 * program-archive.ts does the reading.
 */

import {
  FIDELITIES,
  fail,
  optionalString,
  parseObject,
  parseRights,
  parseSource,
  parseTags,
  requireString,
  type Fidelity,
  type ProgramSource,
  type Rights,
} from './program-catalog.ts';

/** `author_title_year`, with a letter after the year when one author has two
 *  works in a year — the way the papers themselves cite them (Odum 1967a). */
export const WORK_NAME = /^[a-z]+(?:-[a-z]+)*_[a-z0-9]+_\d{4}[a-z]?$/;

export interface WorkSource {
  source: ProgramSource;
  /** Covers every crop in the work: they are all cut from the same publication. */
  rights: Rights;
}

/** What `program.<ext>` shows — the listing as printed — and where it is. */
export interface ProgramCrop {
  caption: string;
  where?: string;
}

/** What `diagram.<ext>` shows, and which figure it is. */
export interface DiagramCrop {
  caption: string;
  figure?: string;
}

export interface ModelMeta {
  title: string;
  description: string;
  fidelity: Fidelity;
  notes?: string;
  tags: string[];
  program?: ProgramCrop;
  diagram?: DiagramCrop;
}

/** One published figure: the listing, run with `changes`, drew it. */
export interface RunMeta {
  /** Where it is in the work, e.g. "Figure 5, p. 73". */
  figure: string;
  /** What the published caption says it shows. Also the plot crop's alt text. */
  caption: string;
  /** Line number to the whole replacement line, which keeps that number. */
  changes: Record<string, string>;
}

const LEADING_ARTICLES = new Set(['a', 'an', 'the']);

/** Lowercase, with accents taken off: "Müller" -> "muller". */
function ascii(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The folder name a citation implies: the first author's family name, the
 * first word of the title that is not an article, and the year.
 */
export function workName(source: ProgramSource): string {
  const family = source.author[0].split(',')[0];
  const author = ascii(family).replace(/[^a-z\s-]/g, '').trim().replace(/\s+/g, '-');
  const words = ascii(source.title)
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  const word = words.find((w) => !LEADING_ARTICLES.has(w)) ?? '';
  return `${author}_${word}_${source.year}`;
}

/** Refuse a folder whose name the citation does not give. A typo in either is
 *  otherwise invisible: the name is only ever read by people. */
export function checkWorkName(work: string, source: ProgramSource): void {
  const expected = workName(source);
  const suffixed = work.length === expected.length + 1 && work.startsWith(expected) && /[a-z]$/.test(work);
  if (work === expected || suffixed) return;
  fail(
    `${work}/source.json`,
    `the folder is named "${work}", but its citation gives "${expected}": the first author's ` +
      `family name, the first word of the title (not "a", "an" or "the"), and the year. ` +
      `A letter after the year tells two works of one year apart, as in ${expected}b.`
  );
}

export function parseWorkSource(work: string, json: string): WorkSource {
  const file = `${work}/source.json`;
  const m = parseObject(file, json);

  if (m.source === undefined || m.source === null) {
    fail(file, '"source" is required: the citation of the work, in BibLaTeX fields');
  }
  const source = parseSource(file, m.source);
  if (source.year === undefined) {
    fail(file, '"source.year" is required: it is part of the folder name');
  }

  const rights = parseRights(file, m.rights, 'rights');
  if (rights.basis === 'own-work') {
    fail(
      file,
      '"rights.basis" cannot be "own-work": everything in a work is cropped from the ' +
        'publication, so say on what basis it is reproduced'
    );
  }
  return { source, rights };
}

export function parseModelMeta(file: string, json: string): ModelMeta {
  const m = parseObject(file, json);

  if (m.source !== undefined) {
    fail(file, '"source" belongs in the work\'s source.json, stated once for every model in it');
  }

  const fidelity = requireString(file, m.fidelity, 'fidelity');
  if (!(FIDELITIES as readonly string[]).includes(fidelity)) {
    fail(file, `"fidelity" must be one of ${FIDELITIES.join(', ')} (got "${fidelity}")`);
  }
  if (fidelity === 'original') {
    fail(
      file,
      'fidelity cannot be "original" in a published work. A program written for this ' +
        'repository has no source, and is a flat programs/<id>.bas instead.'
    );
  }

  const notes = optionalString(file, m.notes, 'notes');
  if (fidelity === 'corrected' && !notes) {
    fail(file, '"notes" is required when fidelity is "corrected": list what was changed and why');
  }

  const program: ProgramCrop | undefined = crop(file, m.program, 'program', 'where');
  const diagram: DiagramCrop | undefined = crop(file, m.diagram, 'diagram', 'figure');

  return {
    title: requireString(file, m.title, 'title'),
    description: requireString(file, m.description, 'description'),
    fidelity: fidelity as Fidelity,
    ...(notes ? { notes } : {}),
    tags: parseTags(file, m.tags),
    ...(program ? { program } : {}),
    ...(diagram ? { diagram } : {}),
  };
}

/** `{ caption, <place> }` describing one crop, or undefined when there is none.
 *  The caption is required: it is the image's alt text. */
function crop<K extends string>(
  file: string,
  raw: unknown,
  field: string,
  place: K
): ({ caption: string } & { [P in K]?: string }) | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(file, `"${field}" must be an object`);
  const c = raw as Record<string, unknown>;
  const caption = requireString(file, c.caption, `${field}.caption`);
  const where = optionalString(file, c[place], `${field}.${place}`);
  return { caption, ...(where ? { [place]: where } : {}) } as { caption: string } & { [P in K]?: string };
}

export function parseRun(file: string, json: string): RunMeta {
  const m = parseObject(file, json);
  const figure = requireString(file, m.figure, 'figure');
  const caption = requireString(file, m.caption, 'caption');

  const changes: Record<string, string> = {};
  if (m.changes !== undefined && m.changes !== null) {
    if (typeof m.changes !== 'object' || Array.isArray(m.changes)) {
      fail(file, '"changes" must be an object from line number to the replacement line');
    }
    for (const [key, value] of Object.entries(m.changes as Record<string, unknown>)) {
      if (!/^\d+$/.test(key)) {
        fail(file, `"changes" is keyed by line number, like "22" (got "${key}")`);
      }
      const line = String(Number(key));
      const text = requireString(file, value, `changes.${key}`);
      // The same number, so that the run reads as a diff against the page: which
      // printed line was changed, and to what.
      if (!new RegExp(`^${line}(?!\\d)`).test(text.replace(/^0+(?=\d)/, ''))) {
        fail(file, `"changes.${key}" must start with its line number ${line} (got "${text}")`);
      }
      changes[line] = text;
    }
  }
  return { figure, caption, changes };
}

/**
 * The listing as a run draws it: each changed line replaced whole, everything
 * else byte for byte. Throws when a change names a line the listing lacks — a
 * run that silently changed nothing would reproduce the wrong figure.
 */
export function applyRun(listing: string, changes: Record<string, string>): string {
  const applied = new Set<string>();
  const lines = listing.split('\n').map((line) => {
    const number = /^\s*(\d+)/.exec(line)?.[1];
    if (number === undefined) return line;
    const key = String(Number(number));
    const replacement = changes[key];
    if (replacement === undefined) return line;
    applied.add(key);
    return replacement + (line.endsWith('\r') ? '\r' : '');
  });
  const missing = Object.keys(changes).filter((key) => !applied.has(key));
  if (missing.length > 0) {
    throw new Error(`the listing has no line ${missing.join(', ')} to change`);
  }
  return lines.join('\n');
}
