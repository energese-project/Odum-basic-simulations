/**
 * The rules behind the library sidebar, kept out of the component so they can
 * be tested without a DOM.
 *
 * A dropdown is fine for five programs and useless for fifty, and the archive is
 * meant to grow into the fifty. So the library is a list with a filter, and the
 * filter searches everything a reader might remember a program by — its title,
 * what it models, its tags, and how faithful it is to the published listing.
 */

import type { ProgramMeta } from './program-catalog.ts';

type Searchable = Pick<ProgramMeta, 'id' | 'title' | 'description' | 'fidelity' | 'tags'>;

/**
 * The programs matching every word of `query`, in their original order.
 * Every word must match somewhere, so typing more narrows the list rather than
 * widening it — "mini-model storage" means both, not either.
 */
export function filterPrograms<T extends Searchable>(programs: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return programs;
  return programs.filter((p) => {
    const haystack = [p.id, p.title, p.description, p.fidelity, ...p.tags]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Whether the sidebar starts open.
 *
 * On a wide screen it sits beside the code, so it is open unless the reader
 * closed it — provenance should be met before the code, not found later. On a
 * narrow screen it covers the code entirely, so it always starts closed and a
 * stored choice does not apply: opening it there is a glance, not a preference.
 */
export function sidebarOpen(stored: string | null, wide: boolean): boolean {
  return wide && stored !== 'closed';
}

/** How the explorer opens a file: BASIC and JSON in the editor, an image in a new tab. */
export type FileKind = 'basic' | 'json' | 'image';

export interface ProgramFile {
  /** Within programs/, as published: the same path publishedFiles() emits. */
  path: string;
  /** What the explorer shows: the path from the program's own folder. */
  name: string;
  kind: FileKind;
}

/** What programFiles reads: satisfied by the build's CatalogEntry and the browser's Program. */
interface Filed {
  file: string;
  sidecar: string;
  work: { file: string } | null;
  diagram?: { file: string } | null;
  programImage: { file: string } | null;
  runs: { file: string; plot: string | null }[];
}

/**
 * Every published file of one program, listing first, in the order a reader
 * checking it would want them: the code, what it claims to be, where it came
 * from, then the pictures and the runs. Together, over the catalog, these are
 * exactly publishedFiles() — program-archive.test.ts holds the two together.
 */
export function programFiles(program: Filed): ProgramFile[] {
  const folder = program.file.includes('/')
    ? program.file.slice(0, program.file.lastIndexOf('/') + 1)
    : '';
  const file = (path: string): ProgramFile => ({
    path,
    name: folder && path.startsWith(folder) ? path.slice(folder.length) : path.split('/').pop()!,
    kind: path.endsWith('.bas') ? 'basic' : path.endsWith('.json') ? 'json' : 'image',
  });

  const paths = [program.file, program.sidecar];
  if (program.work) paths.push(program.work.file);
  if (program.diagram) paths.push(program.diagram.file);
  if (program.programImage) paths.push(program.programImage.file);
  for (const run of program.runs) {
    paths.push(run.file);
    if (run.plot) paths.push(run.plot);
  }
  return paths.map(file);
}
