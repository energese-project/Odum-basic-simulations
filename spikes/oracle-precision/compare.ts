/**
 * Compares the spike's runs, pair by pair, and writes `comparisons.md`.
 *
 * For each pair:
 * - per variable, the largest absolute and relative difference, and its step;
 * - the first step at which the two differ at the precision both printed, which is
 *   the bisection TODO.md asks for if the runs disagree;
 * - the threshold step: the first step at which IV is 0 (line 285, D > 30);
 * - the pixel test, which decides: the pixel each PSET would light, x = T / T0 and
 *   y as in lines 310–365, rounded. The published figure is at screen resolution,
 *   so a difference below a pixel cannot show in it.
 *
 * Usage: node spikes/oracle-precision/compare.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBits, ulps } from './mbf.ts';

const here = dirname(fileURLToPath(import.meta.url));

const COLUMNS = ['T', 'D', 'IV', 'N', 'A', 'M'] as const;
type Column = (typeof COLUMNS)[number];
type Row = Record<Column, number>;

interface Run {
  label: string;
  what: string;
  /** Significant digits the values are known to: what the run printed. */
  digits: number;
}

const RUNS: Record<string, Run> = {
  r1: { label: 'R1', what: 'ours, 64-bit double', digits: 17 },
  r2: { label: 'R2', what: 'PC-BASIC, single (default)', digits: 7 },
  r3: { label: 'R3', what: 'PC-BASIC, `DEFDBL A-Z`', digits: 16 },
  r3d: { label: 'R3d', what: 'PC-BASIC, `DEFDBL A-Z` and `#` literals', digits: 16 },
  r4a: { label: 'R4a', what: 'ours, `Math.fround` on assignment', digits: 17 },
  r4b: { label: 'R4b', what: 'ours, `Math.fround` on every operation', digits: 17 },
};

const PAIRS: [string, string][] = [
  ['r1', 'r2'],
  ['r1', 'r3'],
  ['r1', 'r3d'],
  ['r2', 'r3'],
  ['r2', 'r3d'],
  ['r2', 'r4a'],
  ['r2', 'r4b'],
];

/** The four PSETs of table3.bas, with T0, N0, A0, M0 and D0 as its lines 110–140 set them. */
const SERIES: { name: string; line: number; y: (r: Row) => number }[] = [
  { name: 'N', line: 310, y: (r) => 180 - r.N / 0.05 },
  { name: 'A', line: 330, y: (r) => 180 - r.A / 0.02 },
  { name: 'M', line: 360, y: (r) => 49 - r.M / 0.05 },
  { name: 'D', line: 365, y: (r) => 49 - r.D / 2 },
];
const x = (r: Row): number => r.T / 1;

/**
 * A run's rows. Read as a stream of numbers, six to a row, not line by line:
 * PC-BASIC's `-o` is the 80-column screen, and a double-precision row is wider,
 * so it wraps — between numbers, never inside one. It prints double exponents
 * with D, and a space after every number.
 */
function read(run: string): Row[] {
  const tokens = readFileSync(join(here, 'runs', `${run}.txt`), 'utf8').trim().split(/\s+/);
  const values = tokens.map((t) => Number(t.replace(/D/i, 'E')));
  const bad = values.findIndex((v) => !Number.isFinite(v));
  if (bad >= 0) throw new Error(`${run}.txt: "${tokens[bad]}" is not a number`);
  if (values.length % COLUMNS.length) throw new Error(`${run}.txt: ${values.length} numbers is not whole rows`);
  const rows: Row[] = [];
  for (let i = 0; i < values.length; i += COLUMNS.length) {
    rows.push(Object.fromEntries(COLUMNS.map((c, j) => [c, values[i + j]])) as Row);
  }
  // DT = .5 is exact in every format, so T is a check that the stream is aligned.
  const skewed = rows.findIndex((r, i) => r.T !== (i + 1) * 0.5);
  if (skewed >= 0) throw new Error(`${run}.txt: row ${skewed + 1} has T = ${rows[skewed].T}`);
  return rows;
}

const fmt = (n: number): string => (n === 0 ? '0' : Math.abs(n) < 1e-3 ? n.toExponential(2) : n.toPrecision(3));
const sig = (n: number, digits: number): string => (digits >= 17 ? String(n) : n.toPrecision(digits));

/** The first step, 1-based, at which IV is 0, and T there. */
function threshold(rows: Row[]): string {
  const i = rows.findIndex((r) => r.IV === 0);
  return i < 0 ? 'never' : `step ${i + 1} (T = ${rows[i].T})`;
}

function compare(aName: string, bName: string): string {
  const [a, b] = [read(aName), read(bName)];
  const [ra, rb] = [RUNS[aName], RUNS[bName]];
  const out: string[] = [`### ${ra.label} – ${rb.label}: ${ra.what} vs ${rb.what}`, ''];
  if (a.length !== b.length) out.push(`**Row counts differ: ${a.length} and ${b.length}.**`, '');
  const n = Math.min(a.length, b.length);

  out.push('| Variable | Max abs diff | at step | Max rel diff | at step |', '| --- | --- | --- | --- | --- |');
  for (const c of COLUMNS) {
    let [abs, absAt, rel, relAt] = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const d = Math.abs(a[i][c] - b[i][c]);
      const scale = Math.max(Math.abs(a[i][c]), Math.abs(b[i][c]));
      const r = scale === 0 ? 0 : d / scale;
      if (d > abs) [abs, absAt] = [d, i + 1];
      if (r > rel) [rel, relAt] = [r, i + 1];
    }
    out.push(`| ${c} | ${fmt(abs)} | ${absAt || '—'} | ${fmt(rel)} | ${relAt || '—'} |`);
  }

  const digits = Math.min(ra.digits, rb.digits);
  const differs = (i: number): boolean => COLUMNS.some((c) => sig(a[i][c], digits) !== sig(b[i][c], digits));
  const firstDiff = Array.from({ length: n }, (_, i) => i).find(differs);
  const diffCount = Array.from({ length: n }, (_, i) => i).filter(differs).length;
  out.push(
    '',
    `- **At ${digits} significant digits**: ${
      firstDiff === undefined
        ? 'every row identical'
        : `${diffCount} of ${n} rows differ, the first at step ${firstDiff + 1} (T = ${a[firstDiff].T})`
    }.`,
    `- **Threshold (IV = 0)**: ${ra.label} ${threshold(a)}; ${rb.label} ${threshold(b)}.`,
    '',
    '| Series | PSET line | Steps lighting a different pixel | Max diff, rows | Max diff, unrounded px |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const s of SERIES) {
    let [steps, rows, raw] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const [ya, yb] = [s.y(a[i]), s.y(b[i])];
      const dx = Math.abs(Math.round(x(a[i])) - Math.round(x(b[i])));
      const dy = Math.abs(Math.round(ya) - Math.round(yb));
      if (dx || dy) steps++;
      rows = Math.max(rows, dy);
      raw = Math.max(raw, Math.abs(ya - yb));
    }
    out.push(`| ${s.name} | ${s.line} | ${steps} of ${n} | ${rows} | ${fmt(raw)} |`);
  }
  return out.join('\n');
}

const bits = readBits(join(here, 'runs', 'r2-bits.txt'));

function compareBits(name: string): string {
  const [a, b] = [bits.rows, read(name)];
  const rb = RUNS[name];
  const out: string[] = [`### R2 bits – ${rb.label}: PC-BASIC's MKS$ bytes vs ${rb.what}`, ''];
  const firstDiff = a.findIndex((r, i) => COLUMNS.some((c) => r[c] !== b[i][c]));
  const identical = a.filter((r, i) => COLUMNS.every((c) => r[c] === b[i][c])).length;
  out.push(`- **Rows bit-identical**: ${identical} of ${a.length}.`);
  if (firstDiff >= 0) {
    const cols = COLUMNS.filter((c) => a[firstDiff][c] !== b[firstDiff][c]);
    out.push(
      `- **First difference**: step ${firstDiff + 1} (T = ${a[firstDiff].T}), in ${cols.join(', ')}: ` +
        cols.map((c) => `${c} = ${a[firstDiff][c]} vs ${b[firstDiff][c]}`).join('; ') +
        '.',
    );
  }
  out.push('', '| Variable | Steps differing | Max ulps |', '| --- | --- | --- |');
  for (const c of COLUMNS) {
    const d = a.map((r, i) => ulps(r[c], b[i][c]));
    out.push(`| ${c} | ${d.filter((x) => x > 0).length} | ${Math.max(...d)} |`);
  }
  return out.join('\n');
}

// The bits trace is a different listing from the one R2 ran. It must be the same
// computation, so the decimal rows it printed must be R2's, character for character.
const r2Text = readFileSync(join(here, 'runs', 'r2.txt'), 'utf8').trim().split(/\s+/);
const sameText = r2Text.length === bits.decimal.length && r2Text.every((t, i) => t === bits.decimal[i]);

// PC-BASIC's PRINT of a single is not correctly rounded to seven digits: 0.7401087284
// prints as .7401088. Count how often, against the exact value from the bytes.
const printed = read('r2');
let [roundedUp, offByMore] = [0, 0];
for (let i = 0; i < printed.length; i++) {
  for (const c of COLUMNS) {
    const v = bits.rows[i][c];
    if (v === 0) continue;
    const k = 6 - Math.floor(Math.log10(Math.abs(v)));
    const exact = Math.round(v * 10 ** k);
    const shown = Math.round(printed[i][c] * 10 ** k);
    if (shown === exact + 1) roundedUp++;
    else if (shown !== exact) offByMore++;
  }
}

const report = [
  '# Comparisons',
  '',
  'Generated by `compare.ts` from `runs/`. Do not edit by hand.',
  '',
  '## By printed value',
  '',
  ...PAIRS.map(([a, b]) => compare(a, b) + '\n'),
  '## Bit for bit, against single precision',
  '',
  `- \`r2-bits.txt\`'s decimal rows are ${sameText ? '' : '**not** '}identical to \`r2.txt\`, character for character${sameText ? ', so the bytes are R2\'s own values' : ''}.`,
  `- PRINT rounding: ${roundedUp} of ${printed.length * COLUMNS.length} printed values are one unit above the correctly rounded seven digits; ${offByMore} are off by anything else.`,
  '',
  ...['r4a', 'r4b'].map((r) => compareBits(r) + '\n'),
].join('\n');

writeFileSync(join(here, 'comparisons.md'), report);
console.log(report);
