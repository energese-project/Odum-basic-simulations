/**
 * Compares the runs, pair by pair, and writes `comparisons.md` and `comparisons.json`.
 *
 * For each pair:
 * - per variable, the largest absolute and relative difference, and its step;
 * - the first step at which the two differ at the precision both printed, which is
 *   the bisection TODO.md 0.1 asks for if the runs disagree;
 * - the threshold step: the first step at which IV is 0 (line 285, D > 30);
 * - the pixel test, which decides: the pixel each PSET would light, x = T / T0 and
 *   y as in lines 310–365, rounded. The published figure is at screen resolution,
 *   so a difference below a pixel cannot show in it.
 *
 * Then R4a and R4b against PC-BASIC's own bytes (MKS$), bit for bit.
 *
 * Usage: node validation/oracle/compare.ts
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

export interface Threshold {
  step: number | null;
  T: number | null;
}

/** The first step, 1-based, at which IV is 0, and T there. */
function threshold(rows: Row[]): Threshold {
  const i = rows.findIndex((r) => r.IV === 0);
  return i < 0 ? { step: null, T: null } : { step: i + 1, T: rows[i].T };
}

export interface PairResult {
  a: string;
  b: string;
  rows: number;
  variables: Record<Column, { abs: number; absAt: number; rel: number; relAt: number }>;
  digits: number;
  rowsDifferingAtDigits: number;
  firstDifferingStep: number | null;
  threshold: { a: Threshold; b: Threshold };
  pixels: Record<string, { line: number; steps: number; maxRows: number; maxUnrounded: number }>;
}

function comparePair(aName: string, bName: string): PairResult {
  const [a, b] = [read(aName), read(bName)];
  if (a.length !== b.length) throw new Error(`${aName} has ${a.length} rows, ${bName} ${b.length}`);
  const n = a.length;

  const variables = {} as PairResult['variables'];
  for (const c of COLUMNS) {
    let [abs, absAt, rel, relAt] = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const d = Math.abs(a[i][c] - b[i][c]);
      const scale = Math.max(Math.abs(a[i][c]), Math.abs(b[i][c]));
      const r = scale === 0 ? 0 : d / scale;
      if (d > abs) [abs, absAt] = [d, i + 1];
      if (r > rel) [rel, relAt] = [r, i + 1];
    }
    variables[c] = { abs, absAt, rel, relAt };
  }

  const digits = Math.min(RUNS[aName].digits, RUNS[bName].digits);
  const differs = (i: number): boolean => COLUMNS.some((c) => sig(a[i][c], digits) !== sig(b[i][c], digits));
  const differing = Array.from({ length: n }, (_, i) => i).filter(differs);

  const pixels: PairResult['pixels'] = {};
  for (const s of SERIES) {
    let [steps, maxRows, maxUnrounded] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const [ya, yb] = [s.y(a[i]), s.y(b[i])];
      const dx = Math.abs(Math.round(x(a[i])) - Math.round(x(b[i])));
      const dy = Math.abs(Math.round(ya) - Math.round(yb));
      if (dx || dy) steps++;
      maxRows = Math.max(maxRows, dy);
      maxUnrounded = Math.max(maxUnrounded, Math.abs(ya - yb));
    }
    pixels[s.name] = { line: s.line, steps, maxRows, maxUnrounded };
  }

  return {
    a: aName,
    b: bName,
    rows: n,
    variables,
    digits,
    rowsDifferingAtDigits: differing.length,
    firstDifferingStep: differing.length ? differing[0] + 1 : null,
    threshold: { a: threshold(a), b: threshold(b) },
    pixels,
  };
}

function renderPair(p: PairResult): string {
  const [ra, rb] = [RUNS[p.a], RUNS[p.b]];
  const th = (t: Threshold): string => (t.step === null ? 'never' : `step ${t.step} (T = ${t.T})`);
  return [
    `### ${ra.label} – ${rb.label}: ${ra.what} vs ${rb.what}`,
    '',
    '| Variable | Max abs diff | at step | Max rel diff | at step |',
    '| --- | --- | --- | --- | --- |',
    ...COLUMNS.map((c) => {
      const v = p.variables[c];
      return `| ${c} | ${fmt(v.abs)} | ${v.absAt || '—'} | ${fmt(v.rel)} | ${v.relAt || '—'} |`;
    }),
    '',
    `- **At ${p.digits} significant digits**: ${
      p.firstDifferingStep === null
        ? 'every row identical'
        : `${p.rowsDifferingAtDigits} of ${p.rows} rows differ, the first at step ${p.firstDifferingStep} (T = ${p.firstDifferingStep * 0.5})`
    }.`,
    `- **Threshold (IV = 0)**: ${ra.label} ${th(p.threshold.a)}; ${rb.label} ${th(p.threshold.b)}.`,
    '',
    '| Series | PSET line | Steps lighting a different pixel | Max diff, rows | Max diff, unrounded px |',
    '| --- | --- | --- | --- | --- |',
    ...Object.entries(p.pixels).map(
      ([name, s]) => `| ${name} | ${s.line} | ${s.steps} of ${p.rows} | ${s.maxRows} | ${fmt(s.maxUnrounded)} |`,
    ),
  ].join('\n');
}

export interface BitsResult {
  run: string;
  rows: number;
  identical: number;
  firstDifference: { step: number; columns: string[] } | null;
  ulps: Record<Column, { steps: number; max: number }>;
}

const bits = readBits(join(here, 'runs', 'r2-bits.txt'));

function compareBits(name: string): BitsResult {
  const [a, b] = [bits.rows, read(name)];
  const firstDiff = a.findIndex((r, i) => COLUMNS.some((c) => r[c] !== b[i][c]));
  const ulpsBy = {} as BitsResult['ulps'];
  for (const c of COLUMNS) {
    const d = a.map((r, i) => ulps(r[c], b[i][c]));
    ulpsBy[c] = { steps: d.filter((v) => v > 0).length, max: Math.max(...d) };
  }
  return {
    run: name,
    rows: a.length,
    identical: a.filter((r, i) => COLUMNS.every((c) => r[c] === b[i][c])).length,
    firstDifference:
      firstDiff < 0
        ? null
        : { step: firstDiff + 1, columns: COLUMNS.filter((c) => a[firstDiff][c] !== b[firstDiff][c]) },
    ulps: ulpsBy,
  };
}

function renderBits(r: BitsResult): string {
  const rb = RUNS[r.run];
  return [
    `### R2 bits – ${rb.label}: PC-BASIC's MKS$ bytes vs ${rb.what}`,
    '',
    `- **Rows bit-identical**: ${r.identical} of ${r.rows}.`,
    r.firstDifference
      ? `- **First difference**: step ${r.firstDifference.step}, in ${r.firstDifference.columns.join(', ')}.`
      : '- **No difference.**',
    '',
    '| Variable | Steps differing | Max ulps |',
    '| --- | --- | --- |',
    ...COLUMNS.map((c) => `| ${c} | ${r.ulps[c].steps} | ${r.ulps[c].max} |`),
  ].join('\n');
}

// The bits trace is a different listing from the one R2 ran. It must be the same
// computation, so the decimal rows it printed must be R2's, character for character.
const r2Text = readFileSync(join(here, 'runs', 'r2.txt'), 'utf8').trim().split(/\s+/);
const sameText = r2Text.length === bits.decimal.length && r2Text.every((t, i) => t === bits.decimal[i]);
if (!sameText) throw new Error('r2-bits.txt is not the same computation as r2.txt: its decimal rows differ');

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

const pairs = PAIRS.map(([a, b]) => comparePair(a, b));
const bitwise = ['r4a', 'r4b'].map(compareBits);
const printRounding = { values: printed.length * COLUMNS.length, roundedUp, offByMore };

export interface Comparisons {
  pairs: PairResult[];
  bitwise: BitsResult[];
  printRounding: typeof printRounding;
}
const result: Comparisons = { pairs, bitwise, printRounding };

writeFileSync(join(here, 'comparisons.json'), JSON.stringify(result, null, 2) + '\n');
writeFileSync(
  join(here, 'comparisons.md'),
  [
    '# Comparisons',
    '',
    'Generated by `compare.ts` from `runs/`. Do not edit by hand.',
    '',
    '## By printed value',
    '',
    ...pairs.map((p) => renderPair(p) + '\n'),
    '## Bit for bit, against single precision',
    '',
    "- `r2-bits.txt`'s decimal rows are identical to `r2.txt`, character for character, so the bytes are R2's own values.",
    `- PRINT rounding: ${roundedUp} of ${printRounding.values} printed values are one unit above the correctly rounded seven digits; ${offByMore} are off by anything else.`,
    '',
    ...bitwise.map((r) => renderBits(r) + '\n'),
  ].join('\n'),
);
