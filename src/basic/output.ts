/**
 * Turning program output into something plottable.
 *
 * The published simulation programs were written for a teletype or a 320x200
 * screen, so what they emit is a column of numbers: a PRINT inside the
 * integration loop, typically `PRINT T, Q` or `PRINT T, Q1, Q2`. There is no
 * structured output format to read, and adding one would mean editing every
 * listing — exactly what this repository is trying to avoid.
 *
 * So the numbers are recovered from the text. A run of lines that are entirely
 * numeric and have the same number of fields is a table; the longest such run
 * wins; column 0 is the x axis; a non-numeric line immediately above it with a
 * matching field count supplies the column names.
 *
 * This is a heuristic and it is meant to be one. It reads the programs as they
 * were published rather than requiring them to be rewritten, and when it finds
 * nothing the console still shows the full output. The exact route — teaching
 * the interpreter PSET and LINE so the plotting statements emit points directly
 * — is in TODO.md and will sit alongside this, not replace it: plenty of the
 * listings print a table and never draw at all.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Series {
  label: string;
  points: Point[];
}

export interface Plot {
  xLabel: string;
  series: Series[];
}

/** Fields are separated by a tab (PRINT's comma) or by any run of spaces. */
function fields(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed === '') return [];
  return trimmed.split(/[\t ]+/);
}

function asNumbers(line: string): number[] | null {
  const f = fields(line);
  if (f.length < 2) return null;
  const nums = f.map(Number);
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
}

/**
 * Extract the largest numeric table from program output, or null when there is
 * nothing with at least two rows and two columns to plot.
 */
export function extractPlot(text: string): Plot | null {
  const lines = text.split('\n');

  interface Block {
    start: number;
    rows: number[][];
  }

  const blocks: Block[] = [];
  let current: Block | null = null;

  for (let i = 0; i < lines.length; i++) {
    const nums = asNumbers(lines[i]);
    // A change of width ends the table: two differently shaped runs are two
    // tables, not one ragged one.
    if (current && (!nums || nums.length !== current.rows[0].length)) {
      blocks.push(current);
      current = null;
    }
    if (!nums) continue;
    if (!current) current = { start: i, rows: [] };
    current.rows.push(nums);
  }
  if (current) blocks.push(current);

  let table: Block | null = null;
  for (const b of blocks) {
    if (!table || b.rows.length > table.rows.length) table = b;
  }
  if (!table || table.rows.length < 2) return null;

  const width = table.rows[0].length;
  const labels = headerLabels(lines, table.start, width);

  const series: Series[] = [];
  for (let col = 1; col < width; col++) {
    series.push({
      label: labels[col],
      points: table.rows.map((r) => ({ x: r[0], y: r[col] })),
    });
  }
  return { xLabel: labels[0], series };
}

/**
 * Column names from the nearest non-blank line above the table, when it has the
 * right number of fields — `PRINT "T", "Q"` before the loop is the usual shape.
 */
function headerLabels(lines: string[], start: number, width: number): string[] {
  for (let i = start - 1; i >= 0; i--) {
    const f = fields(lines[i]);
    if (f.length === 0) continue;
    if (f.length === width && asNumbers(lines[i]) === null) return f;
    break; // only the line immediately above counts, blanks aside
  }
  return Array.from({ length: width }, (_, i) => (i === 0 ? 'X' : `Column ${i + 1}`));
}

/** The table as CSV, for download. Quoting is not needed: every cell is a number
 *  and the labels come from BASIC identifiers and string literals in PRINT. */
export function toCsv(plot: Plot): string {
  const header = [plot.xLabel, ...plot.series.map((s) => s.label)].join(',');
  const rows = plot.series[0].points.map((p, i) =>
    [p.x, ...plot.series.map((s) => s.points[i].y)].join(',')
  );
  return [header, ...rows].join('\n') + '\n';
}
