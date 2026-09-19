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
  const reader = new TableReader();
  reader.push(text);
  reader.end();
  return reader.plot;
}

interface Table {
  width: number;
  plot: Plot;
}

function rowCount(table: Table): number {
  return table.plot.series[0].points.length;
}

/**
 * extractPlot, read as the output arrives rather than all at once.
 *
 * A run reaches the page in pieces, and re-reading the whole transcript on each
 * one is quadratic: a 60,000-row run kept the main thread busy for six seconds
 * of its seven. This reads every line once. The plot it reports grows in place
 * — the same Plot, the same point arrays — for as long as the same table is the
 * longest, so the chart can tell more rows of one table from a different table.
 *
 * The rules are extractPlot's, and the tests hold the two to the same answer
 * wherever the pieces happen to split.
 */
export class TableReader {
  /** The end of the output that is not yet a whole line. */
  private partial = '';
  /** The last non-blank line read — the candidate header for a table starting next. */
  private above: string | null = null;
  private current: Table | null = null;
  /** The longest table that has ended. */
  private longest: Table | null = null;

  push(text: string): void {
    const lines = (this.partial + text).split('\n');
    this.partial = lines.pop() ?? '';
    for (const line of lines) this.read(line);
  }

  /** The output is complete: a last line without a newline is still a line. */
  end(): void {
    this.read(this.partial);
    this.partial = '';
    this.close();
  }

  /** The longest table so far, or null while none has two rows. Ties go to the
   *  earlier table. */
  get plot(): Plot | null {
    let table = this.longest;
    if (this.current && (!table || rowCount(this.current) > rowCount(table))) table = this.current;
    return table && rowCount(table) >= 2 ? table.plot : null;
  }

  private read(line: string): void {
    const nums = asNumbers(line);
    // A change of width ends the table: two differently shaped runs are two
    // tables, not one ragged one.
    if (this.current && (!nums || nums.length !== this.current.width)) this.close();
    if (nums) {
      this.current ??= this.open(nums.length);
      const [x, ...ys] = nums;
      this.current.plot.series.forEach((s, i) => s.points.push({ x, y: ys[i] }));
    }
    if (fields(line).length > 0) this.above = line;
  }

  private open(width: number): Table {
    const labels = headerLabels(this.above, width);
    const series: Series[] = labels.slice(1).map((label) => ({ label, points: [] }));
    return { width, plot: { xLabel: labels[0], series } };
  }

  private close(): void {
    const table = this.current;
    this.current = null;
    if (table && (!this.longest || rowCount(table) > rowCount(this.longest))) this.longest = table;
  }
}

/**
 * Column names from the nearest non-blank line above the table, when it has the
 * right number of fields — `PRINT "T", "Q"` before the loop is the usual shape.
 * Only that one line counts, blanks aside.
 */
function headerLabels(above: string | null, width: number): string[] {
  if (above !== null && fields(above).length === width && asNumbers(above) === null) {
    return fields(above);
  }
  return Array.from({ length: width }, (_, i) => (i === 0 ? 'X' : `Column ${i + 1}`));
}

/**
 * The plot with at most `maxRows` rows, for drawing. Always new arrays, never
 * the ones given — a TableReader is still pushing into those.
 *
 * Chart.js re-parses every point on every update, so a long run redrawn while it
 * runs has to be drawn from fewer rows than it printed. The interior rows are cut
 * into buckets of consecutive rows, and each bucket keeps the rows holding the
 * smallest and largest value of every column, x included; the first and last
 * rows are always kept. So no peak is lost, the axes span what was printed, and
 * every kept point is a printed row rather than an average. The same rows are
 * kept for every series, so a tooltip reading all series at one x still reads
 * one row. The CSV and the console keep everything.
 */
export function thinPlot(plot: Plot, maxRows: number): Plot {
  const n = plot.series[0]?.points.length ?? 0;
  const pick = (rows: (points: Point[]) => Point[]): Plot => ({
    xLabel: plot.xLabel,
    series: plot.series.map((s) => ({ label: s.label, points: rows(s.points) })),
  });
  if (n <= maxRows) return pick((points) => points.slice());

  const columns: ((i: number) => number)[] = [
    (i) => plot.series[0].points[i].x,
    ...plot.series.map((s) => (i: number) => s.points[i].y),
  ];
  const buckets = Math.max(1, Math.floor((maxRows - 2) / (2 * columns.length)));
  const size = (n - 2) / buckets;

  const keep = [0];
  for (let b = 0; b < buckets; b++) {
    const from = 1 + Math.floor(b * size);
    const to = 1 + Math.floor((b + 1) * size);
    const rows = new Set<number>();
    for (const value of columns) {
      let lo = from;
      let hi = from;
      for (let i = from + 1; i < to; i++) {
        if (value(i) < value(lo)) lo = i;
        if (value(i) > value(hi)) hi = i;
      }
      if (from < to) rows.add(lo).add(hi);
    }
    keep.push(...[...rows].sort((a, b) => a - b));
  }
  keep.push(n - 1);
  return pick((points) => keep.map((i) => points[i]));
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
