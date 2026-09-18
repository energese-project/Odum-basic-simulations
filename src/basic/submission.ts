/**
 * Turning a filled-in issue form into the files of a program.
 *
 * Someone with a listing and a book in front of them should not need to know
 * git, JSON or BibLaTeX to add it to the archive. They fill in the "Add a
 * program" issue form; the program-submission workflow hands the issue body to
 * this module, and either comments back what is wrong or opens a pull request
 * with `<id>.bas`, `<id>.json` and the diagram.
 *
 * Nothing here decides what a valid program is. The sidecar is built from the
 * form and then put through parseProgramMeta — the same function the build
 * uses — so the form cannot accept anything the build would reject, and a rule
 * added there applies here without a second copy of it.
 *
 * Pure — no filesystem, no DOM — so the same code runs in the submission bot
 * (scripts/submit-program.ts) and in the browser, where the workspace uses it
 * to check a program before handing it to the form.
 */

import { sniffImage } from './image-format.ts';
import { MetadataError, parseProgramMeta, type ProgramMeta } from './program-catalog.ts';

/**
 * The form's field labels, which are the headings GitHub renders into the
 * issue body. They must match .github/ISSUE_TEMPLATE/add-program.yml exactly;
 * submission.test.ts checks that they do.
 */
export const FORM_LABELS = {
  id: 'Program id',
  title: 'Title',
  description: 'Description',
  fidelity: 'Fidelity',
  listing: 'Listing',
  sourceType: 'Source type',
  authors: 'Authors',
  sourceTitle: 'Source title',
  booktitle: 'Book title',
  journal: 'Journal',
  publisher: 'Publisher or institution',
  address: 'Place of publication',
  year: 'Year',
  volume: 'Volume',
  pages: 'Pages',
  edition: 'Edition',
  isbn: 'ISBN',
  doi: 'DOI',
  url: 'URL',
  notes: 'Notes',
  tags: 'Tags',
  diagram: 'Diagram image',
  diagramCaption: 'Diagram caption',
  diagramFigure: 'Diagram figure reference',
  rightsBasis: 'Diagram rights basis',
  rightsStatement: 'Diagram rights statement',
} as const;

/**
 * Each field's `id` in the form, which is what GitHub prefills from the
 * new-issue URL. Not the key: `title` is reserved by GitHub for the issue title,
 * so the program's title is `program_title`. submission.test.ts checks these
 * against the YAML, and against GitHub's reserved parameters.
 */
export const FORM_IDS: Record<keyof typeof FORM_LABELS, string> = {
  id: 'id',
  title: 'program_title',
  description: 'description',
  fidelity: 'fidelity',
  listing: 'listing',
  sourceType: 'source_type',
  authors: 'authors',
  sourceTitle: 'source_title',
  booktitle: 'booktitle',
  journal: 'journal',
  publisher: 'publisher',
  address: 'address',
  year: 'year',
  volume: 'volume',
  pages: 'pages',
  edition: 'edition',
  isbn: 'isbn',
  doi: 'doi',
  url: 'url',
  notes: 'notes',
  tags: 'tags',
  diagram: 'diagram',
  diagramCaption: 'diagram_caption',
  diagramFigure: 'diagram_figure',
  rightsBasis: 'rights_basis',
  rightsStatement: 'rights_statement',
};

/**
 * Sections of the form that are not part of the program. They still have to be
 * recognised as headings: otherwise the text under them — a page photo, the
 * checkbox — runs on into the field before, which is the rights statement.
 */
export const IGNORED_LABELS = ['Photo of the source page', 'Before submitting'] as const;

export type FormField = keyof typeof FORM_LABELS;
export type FormFields = Record<FormField, string>;

/** Everything wrong with a submission, so it can be fixed in one edit. */
export class SubmissionError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

export interface Submission {
  id: string;
  meta: ProgramMeta;
  /** Filename in programs/ → content. Text as strings, the diagram as bytes. */
  files: Record<string, string | Uint8Array>;
}

/** Where GitHub puts a file dragged into an issue. Nothing else is fetched. */
const ATTACHMENT_HOSTS = [
  'https://github.com/user-attachments/',
  'https://user-images.githubusercontent.com/',
  'https://private-user-images.githubusercontent.com/',
];

/** Read the rendered issue body back into fields, by the known headings only —
 *  a "###" inside someone's notes is text, not a new field. */
export function parseIssueForm(body: string): FormFields {
  const text = body.replace(/\r\n?/g, '\n');
  const byLabel = new Map<string, FormField>(
    (Object.entries(FORM_LABELS) as [FormField, string][]).map(([key, label]) => [label, key])
  );

  const fields = Object.fromEntries(
    Object.keys(FORM_LABELS).map((key) => [key, ''])
  ) as FormFields;

  let current: FormField | null = null;
  let lines: string[] = [];
  const flush = (): void => {
    if (!current) return;
    const value = lines.join('\n').trim();
    fields[current] = value === '_No response_' ? '' : value;
  };

  const ignored = new Set<string>(IGNORED_LABELS);
  for (const line of text.split('\n')) {
    const label = /^### (.+)$/.exec(line)?.[1].trim();
    if (label !== undefined && (byLabel.has(label) || ignored.has(label))) {
      flush();
      current = byLabel.get(label) ?? null;
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return fields;
}

/** The URL of the image dropped into the diagram field, or null if there is none. */
export function diagramUrlFrom(fields: FormFields): string | null {
  const text = fields.diagram;
  if (!text) return null;
  const found = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(text) ?? /<img[^>]*\ssrc="([^"]+)"/.exec(text);
  const url = found?.[1] ?? text.trim();
  if (!ATTACHMENT_HOSTS.some((host) => url.startsWith(host))) {
    throw new SubmissionError([
      `${FORM_LABELS.diagram}: drag the image into the form so GitHub hosts it, ` +
        'rather than linking to it elsewhere.',
    ]);
  }
  return url;
}

function listingFrom(raw: string): string {
  const lines = raw.split('\n');
  if (/^```/.test(lines[0] ?? '') && /^```\s*$/.test(lines[lines.length - 1] ?? '')) {
    lines.shift();
    lines.pop();
  }
  const listing = lines.join('\n').replace(/\s+$/, '');
  return listing === '' ? '' : `${listing}\n`;
}

/** Build the program's files from the form, or throw every problem found. */
export function buildSubmission(fields: FormFields, image?: Uint8Array): Submission {
  const problems: string[] = [];
  const need = (field: FormField): string => {
    if (!fields[field]) problems.push(`${FORM_LABELS[field]} is required.`);
    return fields[field];
  };

  const id = need('id');
  if (id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    problems.push(
      `${FORM_LABELS.id} must be lowercase words joined by hyphens, like "two-tank" (got "${id}"). ` +
        'It becomes the filename and the address of the program.'
    );
  }
  need('title');
  need('description');
  need('fidelity');

  const listing = listingFrom(fields.listing);
  if (!listing) problems.push(`${FORM_LABELS.listing} is empty.`);

  if (fields.year && !/^\d{4}$/.test(fields.year)) {
    problems.push(`${FORM_LABELS.year} must be a four-digit year like 1983 (got "${fields.year}").`);
  }

  const describesDiagram = [
    fields.diagram,
    fields.diagramCaption,
    fields.diagramFigure,
    fields.rightsBasis,
    fields.rightsStatement,
  ].some(Boolean);
  let diagramFile: string | undefined;
  if (image) {
    const ext = sniffImage(image);
    if (!ext) {
      problems.push(`${FORM_LABELS.diagram}: the attachment must be a PNG, JPEG or WebP image.`);
    } else {
      diagramFile = `${id}.${ext}`;
    }
  } else if (describesDiagram) {
    problems.push(
      `${FORM_LABELS.diagram}: the diagram fields are filled in but no image was attached. ` +
        'Drag the image into the Diagram image field, or clear the diagram fields.'
    );
  }

  if (problems.length > 0) throw new SubmissionError(problems);

  const sidecar = fieldsToSidecar(fields, diagramFile);
  const json = `${JSON.stringify(sidecar, null, 2)}\n`;
  let meta: ProgramMeta;
  try {
    meta = parseProgramMeta(id, json);
  } catch (e) {
    if (!(e instanceof MetadataError)) throw e;
    // Reported against the form, not against a file the contributor never saw.
    throw new SubmissionError([e.message.replace(/^programs\/[^:]+: /, '')]);
  }

  const files: Record<string, string | Uint8Array> = { [`${id}.bas`]: listing, [`${id}.json`]: json };
  if (diagramFile && image) files[diagramFile] = image;
  return { id, meta, files };
}

/**
 * The sidecar the fields describe, without judging it. The workspace saves a
 * draft on every keystroke, and refusing to save a half-filled form would lose
 * it; whether the result is valid is buildSubmission's question, not this one's.
 */
export function fieldsToSidecar(fields: FormFields, diagramFile?: string): Record<string, unknown> {
  const sidecar: Record<string, unknown> = prune({
    title: fields.title,
    description: fields.description,
    fidelity: fields.fidelity,
  });

  const sourceFields = [
    fields.sourceType, fields.authors, fields.sourceTitle, fields.booktitle, fields.journal,
    fields.publisher, fields.address, fields.year, fields.volume, fields.pages, fields.edition,
    fields.isbn, fields.doi, fields.url,
  ];
  if (sourceFields.some(Boolean)) {
    const institutional = fields.sourceType === 'report' || fields.sourceType === 'thesis';
    sidecar.source = prune({
      type: fields.sourceType,
      author: fields.authors
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean),
      title: fields.sourceTitle,
      booktitle: fields.booktitle,
      journal: fields.journal,
      publisher: institutional ? '' : fields.publisher,
      institution: institutional ? fields.publisher : '',
      address: fields.address,
      // A number when it is one; otherwise kept as typed, for validation to name.
      year: /^\d{4}$/.test(fields.year) ? Number(fields.year) : fields.year,
      volume: fields.volume,
      pages: fields.pages,
      edition: fields.edition,
      isbn: fields.isbn,
      doi: fields.doi,
      url: fields.url,
    });
  }

  if (fields.notes) sidecar.notes = fields.notes;
  const tags = fields.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length > 0) sidecar.tags = tags;

  if (diagramFile) {
    sidecar.diagram = prune({
      file: diagramFile,
      caption: fields.diagramCaption,
      figure: fields.diagramFigure,
      rights:
        fields.rightsBasis || fields.rightsStatement
          ? { basis: fields.rightsBasis, statement: fields.rightsStatement }
          : undefined,
    });
  }
  return sidecar;
}

/** The form fields a sidecar fills in — the inverse of fieldsToSidecar. Lenient
 *  for the same reason: it reads back drafts, including broken ones. */
export function sidecarToFields(id: string, sidecar: unknown): FormFields {
  const fields = Object.fromEntries(Object.keys(FORM_LABELS).map((k) => [k, ''])) as FormFields;
  fields.id = id;
  if (typeof sidecar !== 'object' || sidecar === null) return fields;

  const m = sidecar as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  const record = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

  fields.title = text(m.title);
  fields.description = text(m.description);
  fields.fidelity = text(m.fidelity);
  fields.notes = text(m.notes);
  fields.tags = Array.isArray(m.tags) ? m.tags.map(text).join(', ') : '';

  const source = record(m.source);
  fields.sourceType = text(source.type);
  fields.authors = Array.isArray(source.author) ? source.author.map(text).join('\n') : '';
  fields.sourceTitle = text(source.title);
  fields.booktitle = text(source.booktitle);
  fields.journal = text(source.journal);
  fields.publisher = text(source.publisher) || text(source.institution);
  fields.address = text(source.address);
  fields.year = text(source.year);
  fields.volume = text(source.volume);
  fields.pages = text(source.pages);
  fields.edition = text(source.edition);
  fields.isbn = text(source.isbn);
  fields.doi = text(source.doi);
  fields.url = text(source.url);

  const diagram = record(m.diagram);
  const rights = record(diagram.rights);
  fields.diagramCaption = text(diagram.caption);
  fields.diagramFigure = text(diagram.figure);
  fields.rightsBasis = text(rights.basis);
  fields.rightsStatement = text(rights.statement);
  return fields;
}

/** Past about 8 KB GitHub answers 414 URI Too Long. Kept under it with room to spare. */
export const ISSUE_URL_LIMIT = 7500;

/**
 * The "Add a program" form on GitHub, with every field the program fills in
 * already typed. The listing is the one field that can outgrow a URL; when it
 * does it is left out and `listingIncluded` is false, so the caller can hand it
 * over another way (the clipboard). The diagram never fits: GitHub cannot
 * prefill an attachment, so it is always dragged in by hand.
 */
export function issueFormUrl(
  repositoryUrl: string,
  fields: FormFields,
  listing: string
): { url: string; listingIncluded: boolean } {
  const url = new URL(`${repositoryUrl}/issues/new`);
  url.searchParams.set('template', 'add-program.yml');
  url.searchParams.set('title', `Add program: ${fields.title}`);
  for (const [key, id] of Object.entries(FORM_IDS) as [FormField, string][]) {
    if (key === 'listing' || key === 'diagram' || !fields[key]) continue;
    url.searchParams.set(id, fields[key]);
  }

  const without = url.toString();
  url.searchParams.set(FORM_IDS.listing, listing);
  const withListing = url.toString();
  return withListing.length <= ISSUE_URL_LIMIT
    ? { url: withListing, listingIncluded: true }
    : { url: without, listingIncluded: false };
}

/** Drop empty strings, empty arrays and undefined, so the sidecar holds only what was given. */
function prune(object: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(object).filter(
      ([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
    )
  );
}

export interface Submitter {
  issue: number;
  login: string;
}

export function pullRequestBody(submission: Submission, { issue, login }: Submitter): string {
  const { meta } = submission;
  const files = Object.keys(submission.files)
    .map((f) => `- \`programs/${f}\``)
    .join('\n');
  const rights = meta.diagram
    ? `\n**Diagram rights:** \`${meta.diagram.rights.basis}\` — ${meta.diagram.rights.statement}\n`
    : '';
  return `Submitted by @${login} through the [Add a program](../issues/${issue}) form.

Closes #${issue}

**${meta.title}** — ${meta.description}

**Fidelity:** \`${meta.fidelity}\`
${rights}
${files}

The submission workflow has already checked this against the archive's rules.
What it cannot check, and a reviewer should:

- [ ] the listing matches the source, at the fidelity claimed (a page photo may be in #${issue})
- [ ] the citation is right
${meta.diagram ? '- [ ] the diagram may be published on the rights basis given\n' : ''}
To change anything, edit the issue: the workflow rebuilds this branch.
`;
}

export function commitMessage(
  submission: Submission,
  { issue, login, userId }: Submitter & { userId: number }
): string {
  return `feat(programs): add ${submission.id}

${submission.meta.title} — ${submission.meta.description}
Fidelity: ${submission.meta.fidelity}. Submitted through issue #${issue}.

Co-authored-by: ${login} <${userId}+${login}@users.noreply.github.com>`;
}

/** Marks the bot's comment on the issue, so a re-run edits it instead of adding another. */
export const COMMENT_MARKER = '<!-- program-submission -->';

export function failureComment(problems: string[]): string {
  return `${COMMENT_MARKER}
**This submission can't be added yet.**

${problems.map((p) => `- ${p}`).join('\n')}

Edit this issue to fix these and it will be checked again. The rules are in
[\`programs/README.md\`](../blob/main/programs/README.md).
`;
}

export function successComment(pullRequestUrl: string): string {
  return `${COMMENT_MARKER}
**Checked and ready for review:** ${pullRequestUrl}

Editing this issue rebuilds the pull request. It closes this issue when it is merged.
`;
}
