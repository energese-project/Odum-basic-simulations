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
  work: { id: string; file: string } | null;
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

export type TreeKind = 'work' | 'program' | 'folder' | 'file';

/** One row of the explorer, and what is under it. */
export interface TreeNode {
  /** Stable across renders and filters, so expansion is kept by it. */
  key: string;
  name: string;
  kind: TreeKind;
  /** The program this is, or belongs to. A work belongs to none. */
  programId?: string;
  file?: ProgramFile;
  children: TreeNode[];
}

const byName = (a: TreeNode, b: TreeNode): number =>
  Number(a.kind === 'file') - Number(b.kind === 'file') ||
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * The explorer's tree: the archive laid out as its folders are, the way an
 * editor shows a directory. A work is its folder, holding its source.json and a
 * folder per model; a model's runs are a folder of their own. A single program
 * has no folder on disk, so it gets one named by its title — which is also what
 * a reader knows it by. Inside a folder, folders come first and then files by
 * name, as in VS Code. Works and single programs keep the catalog's order.
 */
export function buildTree<T extends Filed & Searchable>(programs: T[], query: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const works = new Map<string, TreeNode>();

  for (const program of filterPrograms(programs, query)) {
    const node: TreeNode = {
      key: `p:${program.id}`,
      name: program.title,
      kind: 'program',
      programId: program.id,
      children: [],
    };
    for (const file of programFiles(program)) {
      if (program.work && file.path === program.work.file) continue;
      place(node, file.name.split('/'), file, program.id);
    }
    if (!program.work) {
      roots.push(node);
      continue;
    }
    let work = works.get(program.work.id);
    if (!work) {
      const source = programFiles(program).find((f) => f.path === program.work?.file)!;
      work = {
        key: `w:${program.work.id}`,
        name: program.work.id,
        kind: 'work',
        children: [
          { key: `f:${source.path}`, name: source.name, kind: 'file', programId: program.id, file: source, children: [] },
        ],
      };
      works.set(program.work.id, work);
      roots.push(work);
    }
    work.children.push(node);
  }

  const sort = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      n.children.sort(byName);
      sort(n.children);
    }
  };
  sort(roots);
  return roots;
}

function place(parent: TreeNode, parts: string[], file: ProgramFile, programId: string): void {
  const [head, ...rest] = parts;
  if (rest.length === 0) {
    parent.children.push({ key: `f:${file.path}`, name: head, kind: 'file', programId, file, children: [] });
    return;
  }
  const key = `${parent.key}/${head}`;
  let folder = parent.children.find((c) => c.key === key);
  if (!folder) {
    folder = { key, name: head, kind: 'folder', programId, children: [] };
    parent.children.push(folder);
  }
  place(folder, rest, file, programId);
}
