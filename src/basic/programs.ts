/**
 * The program library.
 *
 * There is deliberately no manifest file. The old layout kept one — a JSON array
 * of names next to the .bas files — and it is the kind of list that goes stale
 * the first time someone adds a program and forgets the second step. Vite's glob
 * import builds the same list from the directory at build time, so adding a
 * program means adding a file and nothing else.
 */

import { parseHeader, type ProgramHeader } from './program-header.ts';

const sources = import.meta.glob('../programs/*.bas', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface Program extends ProgramHeader {
  source: string;
}

export const programs: Program[] = Object.entries(sources)
  .map(([path, source]) => {
    const id = path.replace(/^.*\//, '').replace(/\.bas$/, '');
    return { ...parseHeader(id, source), source };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

export function findProgram(id: string | undefined): Program | undefined {
  if (!id) return undefined;
  return programs.find((p) => p.id === id);
}
