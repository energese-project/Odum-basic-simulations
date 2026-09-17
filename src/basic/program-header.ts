/**
 * Reading a program's title out of the listing itself.
 *
 * Kept apart from programs.ts because that module's `import.meta.glob` is a
 * Vite transform, not a runtime feature — importing it under `node --test`
 * throws. This half is ordinary code and can be tested directly.
 */

export interface ProgramHeader {
  id: string;
  title: string;
  description: string;
}

/**
 * A program's first REM is its title and its second is the description, which
 * is roughly how the published listings are headed anyway. Only a contiguous
 * REM block at the very top counts: a REM further down is a comment about the
 * code near it, not a title.
 */
export function parseHeader(id: string, source: string): ProgramHeader {
  const rems: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const m = /^\s*\d+\s+REM\s*(.*)$/i.exec(line);
    if (!m) break;
    rems.push(m[1].trim());
    if (rems.length === 2) break;
  }
  return {
    id,
    title: rems[0] || prettify(id),
    description: rems[1] || '',
  };
}

function prettify(id: string): string {
  return id
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
