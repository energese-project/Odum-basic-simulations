import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instantiateEngine, type Engine, type Program } from './engine.ts';
import { extractPlot } from './output.ts';

/**
 * The archive's mini-models against analytical results — Section 7 of
 * docs/article.tex, and the source of its validation table.
 *
 * Each listing is run as published in programs/, its printed table recovered the
 * way the workbench recovers it, and compared with two references:
 *
 *   - the listing's own Euler recurrence, computed here in the same order of
 *     operations and at the same precision. GW-BASIC prints a single to seven
 *     significant digits, so an engine that does the listing's arithmetic
 *     faithfully differs from this by at most half a unit in the last digit
 *     printed;
 *   - the exact solution of the differential equation the listing discretises.
 *     That difference is the listing's method, not the engine's, so it is
 *     measured and reported but only checked for its expected size.
 *
 * **This measures the C engine, which is what the site runs.** It used to
 * measure the TypeScript interpreter, which the site ran until the worker moved
 * across. The interpreter is still in the tree and still tested, as the second
 * implementation the oracle comparison needs (`scripts/compare-engines.ts`), but
 * a table in the paper describing a runtime no reader can exercise would be a
 * table about the wrong program.
 *
 * The move is what forced the reference recurrence below into `Math.fround`.
 * `BAS_Real` is `float`, so the engine rounds to single after every operation
 * because that is what the type does; against a double-precision recurrence it
 * differs by about one float32 ulp of peak — 232 times the tolerance — and that
 * would be measuring the gap between the machine and an idealisation of it
 * rather than anything about fidelity. Computed in single, as the machine
 * computed, the difference falls back to the printing alone.
 *
 * Run `make test-unit`; the figures in the article are the diagnostics below.
 */

/** Single precision, applied where the engine's `float` type applies it. */
const f = Math.fround;

/** Significant digits GW-BASIC's PRINT gives a single. */
const PRINT_DIGITS = 7;

/**
 * Half a unit in the last digit `PRINT` shows for `v`.
 *
 * The threshold is relative now rather than absolute: seven significant digits
 * quantise 997.8776 at 1e-4 and .8560597 at 1e-7, so one absolute tolerance
 * would be far too loose at one end of a run and impossible at the other.
 */
function halfQuantum(v: number): number {
  if (v === 0) return 0;
  return Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - (PRINT_DIGITS - 1)) / 2;
}

type Row = number[];

let engine: Engine | undefined;

/** One instance for the file: loading a program allocates, running it does not. */
async function theEngine(): Promise<Engine> {
  engine ??= await instantiateEngine(readFileSync(new URL('./engine.wasm', import.meta.url)));
  return engine;
}

async function runListing(id: string): Promise<Row[]> {
  const program: Program = (await theEngine()).load(readFileSync(`programs/${id}.bas`, 'utf8'));
  let out = '';
  try {
    // Stepping in bounded slices is the engine's only mode — it is built so a
    // worker can stop a listing that does not terminate. The guard is that
    // stopping condition, here where there is no worker to enforce it.
    let guard = 0;
    for (;;) {
      const result = program.step(4096);
      out += program.takeText();
      if (result !== 'more') {
        assert.equal(result, 'halted', `${id} ended ${result}: ${program.error()?.message ?? ''}`);
        break;
      }
      assert.ok(++guard < 100_000, `${id} did not terminate`);
    }
  } finally {
    program.free();
  }
  const plot = extractPlot(out);
  assert.ok(plot, `${id} printed no table`);
  return plot.series[0].points.map((p, i) => [p.x, ...plot.series.map((s) => s.points[i].y)]);
}

/**
 * The largest difference between the printed rows and the recurrence, as a
 * multiple of the half-quantum of the digit it was printed to.
 *
 * At most 1 means every printed value is the recurrence rounded to what PRINT
 * shows — that is, the two agree exactly and only the display differs.
 */
function maxQuanta(printed: Row[], ref: Row[]): number {
  assert.equal(printed.length, ref.length, 'row counts differ');
  let m = 0;
  printed.forEach((row, i) =>
    row.forEach((v, j) => {
      const h = Math.max(halfQuantum(v), halfQuantum(ref[i][j]));
      if (h > 0) m = Math.max(m, Math.abs(v - ref[i][j]) / h);
    })
  );
  return m;
}

/** The same difference as a fraction of the value, which is the article's column. */
function maxRelative(printed: Row[], ref: Row[]): number {
  let m = 0;
  printed.forEach((row, i) =>
    row.forEach((v, j) => {
      if (ref[i][j] !== 0) m = Math.max(m, Math.abs(v - ref[i][j]) / Math.abs(ref[i][j]));
    })
  );
  return m;
}

/** Largest difference in the state columns, as a fraction of each column's peak. */
function maxScaled(a: Row[], b: Row[]): number {
  let m = 0;
  for (let j = 1; j < b[0].length; j++) {
    const peak = Math.max(...b.map((r) => Math.abs(r[j])));
    a.forEach((row, i) => (m = Math.max(m, Math.abs(row[j] - b[i][j]) / peak)));
  }
  return m;
}

/**
 * Check the printed run against the recurrence, and report the row the article
 * takes its figures from.
 *
 * The quantum check is the assertion; the relative figure is what the table
 * prints, because `\le 5\times10^{-7}` is legible in a way `\le 1` half-unit in
 * the seventh digit is not. They are the same fact: seven significant digits
 * put the worst case of the second at 5e-7 of the value.
 */
function checkAgainstRecurrence(
  t: { diagnostic: (m: string) => void },
  id: string,
  printed: Row[],
  recurrence: Row[],
  vsExact: number
): void {
  const quanta = maxQuanta(printed, recurrence);
  const relative = maxRelative(printed, recurrence);
  t.diagnostic(
    `${id}: ${printed.length} rows; |engine - recurrence| <= ${quanta.toFixed(3)} of a ` +
      `half-unit in the 7th printed digit (${relative.toExponential(1)} of the value); ` +
      `|recurrence - exact| <= ${(vsExact * 100).toFixed(2)}% of peak`
  );
  // A hair over 1: the half-quantum is a power of ten, which is not exactly
  // representable, and logistic-growth lands on an exact tie (52.203125 prints
  // as 52.20312). Slack of 1e-9 covers the arithmetic without covering an ulp.
  assert.ok(quanta <= 1 + 1e-9, `${id} is off the recurrence by ${quanta} half-quanta`);
  assert.ok(relative <= 5e-7, `${id} is off the recurrence by ${relative} of the value`);
}

test('charge and discharge: dQ/dt = J - K1*Q', async (t) => {
  const J = f(100), K1 = f(0.1), DT = f(0.5);
  const printed = await runListing('charge-discharge');

  const recurrence: Row[] = [];
  const exact: Row[] = [];
  let q = 0;
  for (let T = 0; T <= 60; T = f(T + DT)) {
    const F = f(K1 * q);
    recurrence.push([T, q, F]);
    // The exact solution is mathematics, not the machine, so it stays in double.
    const qe = (100 / 0.1) * (1 - Math.exp(-0.1 * T));
    exact.push([T, qe, 0.1 * qe]);
    q = f(q + f(f(J - F) * DT));
  }

  const vsExact = maxScaled(recurrence, exact);
  assert.equal(printed.length, 121);
  checkAgainstRecurrence(t, 'charge-discharge', printed, recurrence, vsExact);
  // First-order Euler at K1*DT = 0.05: about 1% of the plateau on the way up,
  // gone at steady state.
  assert.ok(vsExact > 0.005 && vsExact < 0.05, `Euler error ${vsExact}`);
});

test('logistic growth: dQ/dt = K1*Q*(ST - Q) - K2*Q', async (t) => {
  const ST = f(1000), K1 = f(0.0004), K2 = f(0.02), DT = f(0.5), Q0 = f(10);
  const printed = await runListing('logistic-growth');

  // Logistic with rate r and ceiling C: the depreciation lowers both.
  const r = 0.0004 * 1000 - 0.02;
  const C = 1000 - 0.02 / 0.0004;
  const exactQ = (T: number) => C / (1 + ((C - 10) / 10) * Math.exp(-r * T));

  const recurrence: Row[] = [];
  const exact: Row[] = [];
  let q = Q0;
  for (let T = 0; T <= 200; T = f(T + DT)) {
    const s = f(ST - q);
    const g = f(f(K1 * q) * s);
    const d = f(K2 * q);
    recurrence.push([T, q, s]);
    exact.push([T, exactQ(T), 1000 - exactQ(T)]);
    q = f(q + f(f(g - d) * DT));
  }

  const vsExact = maxScaled(recurrence, exact);
  assert.equal(printed.length, 401);
  checkAgainstRecurrence(t, 'logistic-growth', printed, recurrence, vsExact);
  assert.ok(vsExact > 0.01 && vsExact < 0.1, `Euler error ${vsExact}`);
});

/**
 * The two-tank listing, against the exact solution with the inflow cut at `CUT`.
 *
 * Both cut-offs are computed because the article's table reports both, and a
 * number in the table that no test prints is a number nobody rechecks: the
 * gap between them is the finding, not a detail of one row.
 */
function twoTank(CUT: number): { recurrence: Row[]; exact: Row[] } {
  const J0 = f(50), K1 = f(0.15), K2 = f(0.05), DT = f(0.25);

  function exactAt(T: number): [number, number] {
    const phase1 = (s: number): [number, number] => {
      const c = 50 / (0.15 - 0.05);
      const q1 = (50 / 0.15) * (1 - Math.exp(-0.15 * s));
      const q2 = 50 / 0.05 + c * Math.exp(-0.15 * s) - (50 / 0.05 + c) * Math.exp(-0.05 * s);
      return [q1, q2];
    };
    if (T <= CUT) return phase1(T);
    const [q1c, q2c] = phase1(CUT);
    const s = T - CUT;
    const g = (0.15 * q1c) / (0.05 - 0.15);
    return [q1c * Math.exp(-0.15 * s), g * Math.exp(-0.15 * s) + (q2c - g) * Math.exp(-0.05 * s)];
  }

  const recurrence: Row[] = [];
  const exact: Row[] = [];
  let q1 = 0, q2 = 0, J = J0;
  for (let T = 0; T <= 80; T = f(T + DT)) {
    const f1 = f(K1 * q1);
    const f2 = f(K2 * q2);
    recurrence.push([T, q1, q2]);
    exact.push([T, ...exactAt(T)]);
    q1 = f(q1 + f(f(J - f1) * DT));
    q2 = f(q2 + f(f(f1 - f2) * DT));
    if (T > 40) J = 0;
  }
  return { recurrence, exact };
}

test('two tanks in series, with the inflow cut where the listing actually cuts it', async (t) => {
  const printed = await runListing('two-tank');

  // `IF T > 40 THEN LET J = 0` runs after the update, so the step that starts at
  // T = 40.25 still uses J = 50: the inflow stops at t = 40.5, not at the t = 40
  // the listing announces. The exact solution is taken with the listing's cut-off.
  const { recurrence, exact } = twoTank(40.5);
  const vsExact = maxScaled(recurrence, exact);
  assert.equal(printed.length, 321);
  checkAgainstRecurrence(t, 'two-tank (cut at t = 40.5)', printed, recurrence, vsExact);
  assert.ok(vsExact > 0.001 && vsExact < 0.05, `Euler error ${vsExact}`);
});

test('two tanks in series, against the cut-off the listing announces', async (t) => {
  const printed = await runListing('two-tank');

  // The same run, measured against the t = 40 the listing prints. The run does
  // not change; only the reference does, and the error grows tenfold. That gap
  // is what exposes the off-by-one-step, and it is why the listing is kept as
  // written rather than corrected.
  const { recurrence, exact } = twoTank(40);
  const vsExact = maxScaled(recurrence, exact);
  checkAgainstRecurrence(t, 'two-tank (cut at t = 40, as printed)', printed, recurrence, vsExact);
  assert.ok(vsExact > 0.05 && vsExact < 0.1, `Euler error ${vsExact}`);
});
