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
