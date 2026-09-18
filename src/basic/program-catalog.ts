/**
 * The shape of a program's metadata sidecar, and the rules for reading one.
 *
 * Every `programs/<id>.bas` has a `programs/<id>.json` beside it saying where
 * the listing came from. That provenance is the point of the archive: a program
 * is only useful for checking Odum's work if you can see which book, paper or
 * report it was taken from, and how faithfully.
 *
 * `fidelity` is the field that matters most and the one a contributor is most
 * likely to want to skip, so it is required and has no default. A listing
 * typed from a scanned page and a listing written from a described model are
 * both legitimate here, but they answer different questions, and a reader must
 * not have to guess which one they are looking at.
 *
 * Deliberately no schema library. Validation is a few dozen lines against a
 * fixed shape, it runs at build time where a clear message matters more than
 * generality, and a dependency here would be one more thing that has to still
 * exist in ten years.
 *
 * This module is pure: no DOM, no filesystem. The Vite plugin in
 * vite.config.js does the reading and hands it strings, and the unit tests
 * exercise it directly.
 */

/** BibLaTeX entry types, restricted to the ones this material actually uses. */
export const SOURCE_TYPES = ['book', 'incollection', 'article', 'report', 'thesis', 'unpublished'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * How close this file is to what was published.
 *  - `verbatim`   transcribed from the source, character for character
 *  - `corrected`  transcribed, with typographic errors in the original fixed;
 *                 every change listed in `notes`
 *  - `adapted`    the published model, rewritten to run here
 *  - `original`   not from a published listing; written for this repository
 */
export const FIDELITIES = ['verbatim', 'corrected', 'adapted', 'original'] as const;
export type Fidelity = (typeof FIDELITIES)[number];

export interface ProgramSource {
  type: SourceType;
  /** "Family, Given" per BibLaTeX, so it sorts and formats predictably. */
  author: string[];
  title: string;
  booktitle?: string;
  journal?: string;
  publisher?: string;
  institution?: string;
  address?: string;
  year?: number;
  volume?: string;
  pages?: string;
  edition?: string;
  isbn?: string;
  doi?: string;
  url?: string;
}

/**
 * On what basis a diagram is reproduced here.
 *  - `own-work`       drawn for this repository; nothing to clear
 *  - `public-domain`  out of copyright, or never in it
 *  - `licensed`       under a licence that allows it (say which in the statement)
 *  - `permission`     the rights holder agreed (say who, and when)
 *  - `fair-use`       fair use or fair dealing: reproduced for scholarship,
 *                     criticism or review, beside the listing it documents
 *
 * Like fidelity, there is no default. A figure from a book is someone's work,
 * and the person adding it is the one who has to say why it may be here.
 */
export const RIGHTS_BASES = ['own-work', 'public-domain', 'licensed', 'permission', 'fair-use'] as const;
export type RightsBasis = (typeof RIGHTS_BASES)[number];

/** Raster only: a raw SVG opened from the published site would run its scripts. */
export const DIAGRAM_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

export interface ProgramDiagram {
  /** `<id>.<ext>` in programs/ — one diagram per program. */
  file: string;
  /** What the diagram shows. Also its alt text. */
  caption: string;
  /** Where it is in the source, e.g. "Figure 5-3, p. 112". */
  figure?: string;
  rights: { basis: RightsBasis; statement: string };
}

export interface ProgramMeta {
  id: string;
  title: string;
  description: string;
  fidelity: Fidelity;
  /** Absent only when fidelity is `original` — there is no source to cite. */
  source?: ProgramSource;
  notes?: string;
  tags: string[];
  diagram?: ProgramDiagram;
}

export class MetadataError extends Error {}

function fail(id: string, message: string): never {
  throw new MetadataError(`programs/${id}.json: ${message}`);
}

function requireString(id: string, value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(id, `"${field}" is required and must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(id: string, value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(id, `"${field}" must be a string`);
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseSource(id: string, raw: unknown): ProgramSource {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(id, '"source" must be an object');
  }
  const s = raw as Record<string, unknown>;

  const type = requireString(id, s.type, 'source.type');
  if (!(SOURCE_TYPES as readonly string[]).includes(type)) {
    fail(id, `"source.type" must be one of ${SOURCE_TYPES.join(', ')} (got "${type}")`);
  }

  if (!Array.isArray(s.author) || s.author.length === 0) {
    fail(id, '"source.author" is required and must be a non-empty array');
  }
  const author = s.author.map((a, i) => requireString(id, a, `source.author[${i}]`));

  let year: number | undefined;
  if (s.year !== undefined && s.year !== null) {
    if (typeof s.year !== 'number' || !Number.isInteger(s.year)) {
      fail(id, '"source.year" must be an integer, not a string');
    }
    year = s.year;
  }

  const doi = optionalString(id, s.doi, 'source.doi');
  if (doi && !/^10\.\d{4,9}\//.test(doi)) {
    // A bare DOI, not a doi.org URL: the display layer builds the link, so a
    // URL here would produce https://doi.org/https://doi.org/...
    fail(id, `"source.doi" must be a bare DOI beginning "10." (got "${doi}")`);
  }

  return {
    type: type as SourceType,
    author,
    title: requireString(id, s.title, 'source.title'),
    booktitle: optionalString(id, s.booktitle, 'source.booktitle'),
    journal: optionalString(id, s.journal, 'source.journal'),
    publisher: optionalString(id, s.publisher, 'source.publisher'),
    institution: optionalString(id, s.institution, 'source.institution'),
    address: optionalString(id, s.address, 'source.address'),
    year,
    volume: optionalString(id, s.volume, 'source.volume'),
    pages: optionalString(id, s.pages, 'source.pages'),
    edition: optionalString(id, s.edition, 'source.edition'),
    isbn: optionalString(id, s.isbn, 'source.isbn'),
    doi,
    url: optionalString(id, s.url, 'source.url'),
  };
}

function parseDiagram(id: string, raw: unknown, hasSource: boolean): ProgramDiagram {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(id, '"diagram" must be an object');
  }
  const d = raw as Record<string, unknown>;

  const file = requireString(id, d.file, 'diagram.file');
  const named = new RegExp(`^${id}\\.(${DIAGRAM_EXTENSIONS.join('|')})$`);
  if (!named.test(file)) {
    fail(
      id,
      `"diagram.file" must be ${id}.${DIAGRAM_EXTENSIONS.join(` or ${id}.`)}, ` +
        `beside the listing (got "${file}")`
    );
  }

  const caption = requireString(id, d.caption, 'diagram.caption');
  const figure = optionalString(id, d.figure, 'diagram.figure');

  if (typeof d.rights !== 'object' || d.rights === null || Array.isArray(d.rights)) {
    fail(
      id,
      `"diagram.rights" is required: an object with "basis" (${RIGHTS_BASES.join(', ')}) ` +
        'and a "statement" saying why this image may be published here'
    );
  }
  const r = d.rights as Record<string, unknown>;
  const basis = requireString(id, r.basis, 'diagram.rights.basis');
  if (!(RIGHTS_BASES as readonly string[]).includes(basis)) {
    fail(id, `"diagram.rights.basis" must be one of ${RIGHTS_BASES.join(', ')} (got "${basis}")`);
  }
  const statement = requireString(id, r.statement, 'diagram.rights.statement');

  if (basis !== 'own-work' && !hasSource) {
    fail(
      id,
      `a reproduced diagram needs a "source" to say where it was reproduced from ` +
        `(rights basis is "${basis}"). A diagram drawn for this repository is "own-work".`
    );
  }

  return {
    file,
    caption,
    ...(figure ? { figure } : {}),
    rights: { basis: basis as RightsBasis, statement },
  };
}

/**
 * Parse one sidecar. Throws MetadataError with a message naming the file and
 * the field, because this runs in a build and the reader is a contributor who
 * has just added a program, not someone who knows this code.
 */
export function parseProgramMeta(id: string, json: string): ProgramMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    fail(id, `is not valid JSON — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(id, 'must contain a JSON object');
  }
  const m = raw as Record<string, unknown>;

  const fidelity = requireString(id, m.fidelity, 'fidelity');
  if (!(FIDELITIES as readonly string[]).includes(fidelity)) {
    fail(id, `"fidelity" must be one of ${FIDELITIES.join(', ')} (got "${fidelity}")`);
  }

  const hasSource = m.source !== undefined && m.source !== null;
  if (fidelity !== 'original' && !hasSource) {
    fail(id, `"source" is required unless fidelity is "original" (fidelity is "${fidelity}")`);
  }
  if (fidelity === 'original' && hasSource) {
    fail(id, '"source" must be omitted when fidelity is "original" — there is nothing to cite');
  }

  const notes = optionalString(id, m.notes, 'notes');
  if (fidelity === 'corrected' && !notes) {
    // The whole value of "corrected" over "verbatim" is knowing what changed.
    fail(id, '"notes" is required when fidelity is "corrected": list what was changed and why');
  }

  let tags: string[] = [];
  if (m.tags !== undefined && m.tags !== null) {
    if (!Array.isArray(m.tags)) fail(id, '"tags" must be an array');
    tags = m.tags.map((t, i) => requireString(id, t, `tags[${i}]`));
  }

  return {
    id,
    title: requireString(id, m.title, 'title'),
    description: requireString(id, m.description, 'description'),
    fidelity: fidelity as Fidelity,
    source: hasSource ? parseSource(id, m.source) : undefined,
    notes,
    tags,
    ...(m.diagram !== undefined && m.diagram !== null
      ? { diagram: parseDiagram(id, m.diagram, hasSource) }
      : {}),
  };
}

/** "Odum, Howard T." -> "H. T. Odum"; anything else is passed through. */
export function formatAuthor(name: string): string {
  const [family, given] = name.split(',').map((p) => p.trim());
  if (!given) return name.trim();
  const initials = given
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.endsWith('.') ? part : `${part.charAt(0)}.`))
    .join(' ');
  return `${initials} ${family}`;
}

export function formatAuthors(names: string[]): string {
  const formatted = names.map(formatAuthor);
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(', ')} and ${formatted[formatted.length - 1]}`;
}

/**
 * A single-line citation for the metadata panel. Not a full BibLaTeX renderer —
 * the fields are there for anyone who wants to build one, and the raw sidecar is
 * a click away. This is the human-readable line above it.
 */
export function formatCitation(source: ProgramSource): string {
  const parts: string[] = [formatAuthors(source.author)];
  if (source.year !== undefined) parts[0] += ` (${source.year})`;

  parts.push(source.title);

  const container = source.journal ?? source.booktitle;
  if (container) parts.push(source.journal ? container : `In: ${container}`);
  if (source.volume) parts.push(`vol. ${source.volume}`);
  if (source.edition) parts.push(`${source.edition} ed.`);

  const imprint = [source.address, source.publisher ?? source.institution]
    .filter(Boolean)
    .join(': ');
  if (imprint) parts.push(imprint);

  if (source.pages) parts.push(`pp. ${source.pages}`);

  return parts.join('. ').replace(/\.\.$/, '.') + (parts[parts.length - 1].endsWith('.') ? '' : '.');
}

/** In the order a BibLaTeX entry is conventionally written. */
const BIBTEX_FIELDS = [
  'author',
  'title',
  'booktitle',
  'journal',
  'publisher',
  'institution',
  'address',
  'year',
  'volume',
  'pages',
  'edition',
  'isbn',
  'doi',
  'url',
] as const;

/** Read verbatim by BibLaTeX: escaping a character here would break the link. */
const VERBATIM_FIELDS = new Set(['doi', 'url']);

function escapeLatex(text: string): string {
  return text.replace(/[&%$#_]/g, (c) => `\\${c}`);
}

/**
 * The source as a BibLaTeX entry, keyed by the program id, for a reader who
 * wants to cite the listing's origin without retyping it. The fields are the
 * sidecar's own, which were named after BibLaTeX's for exactly this reason.
 */
export function toBibtex(key: string, source: ProgramSource): string {
  const lines: string[] = [];
  for (const field of BIBTEX_FIELDS) {
    const raw = source[field];
    if (raw === undefined) continue;
    let value = Array.isArray(raw) ? raw.join(' and ') : String(raw);
    if (field === 'pages') value = value.replace(/(\d)\s*-\s*(\d)/g, '$1--$2');
    if (!VERBATIM_FIELDS.has(field)) value = escapeLatex(value);
    lines.push(`  ${field} = {${value}}`);
  }
  return `@${source.type}{${key},\n${lines.join(',\n')}\n}`;
}
