/**
 * A listing that draws, read as a plot and a table like a listing that prints.
 *
 * Odum's PC listings (MACROEC, 1989) never PRINT: they PSET each variable against
 * time onto a 320 x 200 screen. The site shows every program the same way — a
 * chart, a table and a CSV — so the points are read back from the DrawOps rather
 * than rasterised. What the PC drew pixel for pixel is still compared, in
 * validation/oracle/, against PC-BASIC; the site shows what the run computed.
 *
 * Each PSET statement is a series, and each run is separate: CONT starts a run of
 * its own, because MACROEC's second experiment starts its clock again. The points
 * stay in the listing's own screen coordinates. A PSET's y is an expression such
 * as `180 - Y / Y0`, and undoing it in general would mean evaluating the listing's
 * scaling backwards, so the axis says it is screen rows and is reversed, making up
 * on the PC up on the chart. The series are named by what the listing wrote, so a
 * reader can see the scaling rather than trust it.
 *
 * LINE is not read. MACROEC draws only its frame with it; a listing that draws
 * curves with LINE would plot nothing here, and should be added when one is
 * archived.
 */

import type { DrawOp } from './interpreter.ts';
import type { Plot, Point, Series } from './output.ts';

/** The x and y expressions of the first PSET on a line, or null. */
export function psetArguments(line: string): { x: string; y: string } | null {
  const at = line.search(/\bPSET\s*\(/i);
  if (at < 0) return null;
  // Not in a string: an even number of quotes before it.
  if ((line.slice(0, at).match(/"/g)?.length ?? 0) % 2 === 1) return null;
  let i = line.indexOf('(', at) + 1;
  let depth = 0;
  let comma = -1;
  for (const start = i; i < line.length; i++) {
    const c = line[i];
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) {
        if (comma < 0) return null;
        return { x: line.slice(start, comma).trim(), y: line.slice(comma + 1, i).trim() };
      }
      depth--;
    } else if (c === ',' && depth === 0 && comma < 0) comma = i;
  }
  return null;
}

/** The listing's lines by number. */
function linesByNumber(listing: string): Map<number, string> {
  const lines = new Map<number, string>();
  for (const text of listing.split(/\r?\n/)) {
    const m = /^\s*(\d+)/.exec(text);
    if (m) lines.set(Number(m[1]), text);
  }
  return lines;
}

const COLUMN = 14;

export class DrawReader {
  private readonly lines: Map<number, string>;
  /** Keyed by run and line, in the order each was first drawn. */
  private readonly series = new Map<string, { run: number; line: number; points: Point[] }>();
  private run = 1;

  constructor(listing: string) {
    this.lines = linesByNumber(listing);
  }

  push(ops: DrawOp[]): void {
    for (const op of ops) {
      if (op.op !== 'pset') continue;
      const key = `${this.run}:${op.line}`;
      let s = this.series.get(key);
      if (!s) {
        s = { run: this.run, line: op.line, points: [] };
        this.series.set(key, s);
      }
      s.points.push({ x: op.x, y: op.y });
    }
  }

  /** CONT: what is drawn next is another run. A run that drew nothing is not one. */
  nextRun(): void {
    if ([...this.series.values()].some((s) => s.run === this.run)) this.run++;
  }

  get plot(): Plot | null {
    const all = [...this.series.values()];
    if (all.length === 0) return null;
    const runs = new Set(all.map((s) => s.run)).size;
    const args = (line: number) => psetArguments(this.lines.get(line) ?? '');
    const series: Series[] = all.map((s) => {
      const y = args(s.line)?.y;
      const name = y ? `line ${s.line}: ${y}` : `line ${s.line}`;
      return { label: runs > 1 ? `${name}, run ${s.run}` : name, points: s.points, line: s.line, run: s.run };
    });
    return {
      xLabel: args(all[0].line)?.x ?? 'x',
      yLabel: 'screen row, as PSET drew it',
      yReversed: true,
      independent: true,
      series,
    };
  }

  /**
   * The points as a table, for the output pane: a run, a line and a point per row.
   * Seven significant digits, which is what the engine's single precision carries
   * and what PRINT would show; the CSV keeps every digit.
   */
  table(): string {
    const pad = (v: string | number, w: number) => `${String(v).padEnd(w - 1)} `;
    const num = (v: number) => String(Number(v.toPrecision(7)));
    const rows = [...this.series.values()]
      .flatMap((s) => s.points.map((p) => ({ run: s.run, line: s.line, ...p })));
    return [
      `${pad('RUN', 6)}${pad('LINE', 7)}${pad('X', COLUMN)}Y`,
      ...rows.map((r) => `${pad(` ${r.run}`, 6)}${pad(r.line, 7)}${pad(num(r.x), COLUMN)}${num(r.y)}`),
    ].join('\n');
  }
}
