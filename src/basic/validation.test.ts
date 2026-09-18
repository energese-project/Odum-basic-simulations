import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Basic } from './interpreter.ts';
import { extractPlot } from './output.ts';

/**
 * The archive's mini-models against analytical results — Section 7 of
 * docs/article.tex, and the source of its validation table.
 *
 * Each listing is run as published in programs/, its printed table recovered the
 * way the workbench recovers it, and compared with two references:
 *
 *   - the listing's own Euler recurrence, computed here in the same order of
 *     operations. PRINT rounds to six decimal places, so an interpreter that does
 *     the listing's arithmetic faithfully differs from this by at most 5e-7;
 *   - the exact solution of the differential equation the listing discretises.
 *     That difference is the listing's method, not the interpreter's, so it is
 *     measured and reported but only checked for its expected size.
 *
 * Run `npm test`; the figures in the article are the diagnostics printed below.
 */

// Half a unit in the sixth decimal place, plus the float error of the rounding
// itself: Math.round(x * 1e6) / 1e6 is not exactly representable either.
const PRINT_ROUNDING = 5e-7 + 1e-12;

type Row = number[];

async function runListing(id: string): Promise<Row[]> {
  let out = '';
  const interp = new Basic({ print: (t) => (out += t) });
  interp.load(readFileSync(`programs/${id}.bas`, 'utf8'));
  await interp.run();
  const plot = extractPlot(out);
  assert.ok(plot, `${id} printed no table`);
  return plot.series[0].points.map((p, i) => [p.x, ...plot.series.map((s) => s.points[i].y)]);
}

/** Largest absolute difference, column by column, over every printed row. */
function maxAbs(a: Row[], b: Row[]): number {
  assert.equal(a.length, b.length, 'row counts differ');
  let m = 0;
  a.forEach((row, i) => row.forEach((v, j) => (m = Math.max(m, Math.abs(v - b[i][j])))));
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

function report(
  t: { diagnostic: (m: string) => void },
  id: string,
  rows: number,
  vsRecurrence: number,
  vsExact: number
): void {
  t.diagnostic(
    `${id}: ${rows} rows; |interpreter - recurrence| <= ${vsRecurrence.toExponential(1)}; ` +
      `|recurrence - exact| <= ${(vsExact * 100).toFixed(2)}% of peak`
  );
}

test('charge and discharge: dQ/dt = J - K1*Q', async (t) => {
  const J = 100, K1 = 0.1, DT = 0.5;
  const printed = await runListing('charge-discharge');

  const recurrence: Row[] = [];
  const exact: Row[] = [];
  let q = 0;
  for (let T = 0; T <= 60; T += DT) {
    const f = K1 * q;
    recurrence.push([T, q, f]);
    const qe = (J / K1) * (1 - Math.exp(-K1 * T));
    exact.push([T, qe, K1 * qe]);
    q = q + (J - f) * DT;
  }

  const vsRecurrence = maxAbs(printed, recurrence);
  const vsExact = maxScaled(recurrence, exact);
  report(t, 'charge-discharge', printed.length, vsRecurrence, vsExact);

  assert.equal(printed.length, 121);
  assert.ok(vsRecurrence <= PRINT_ROUNDING, `off the recurrence by ${vsRecurrence}`);
  // First-order Euler at K1*DT = 0.05: about 1% of the plateau on the way up,
  // gone at steady state.
  assert.ok(vsExact > 0.005 && vsExact < 0.05, `Euler error ${vsExact}`);
});

test('logistic growth: dQ/dt = K1*Q*(ST - Q) - K2*Q', async (t) => {
  const ST = 1000, K1 = 0.0004, K2 = 0.02, DT = 0.5, Q0 = 10;
  const printed = await runListing('logistic-growth');

  // Logistic with rate r and ceiling C: the depreciation lowers both.
  const r = K1 * ST - K2;
  const C = ST - K2 / K1;
  const exactQ = (T: number) => C / (1 + ((C - Q0) / Q0) * Math.exp(-r * T));

  const recurrence: Row[] = [];
  const exact: Row[] = [];
  let q = Q0;
  for (let T = 0; T <= 200; T += DT) {
    const s = ST - q;
    const g = K1 * q * s;
    const d = K2 * q;
    recurrence.push([T, q, s]);
    exact.push([T, exactQ(T), ST - exactQ(T)]);
    q = q + (g - d) * DT;
  }

  const vsRecurrence = maxAbs(printed, recurrence);
  const vsExact = maxScaled(recurrence, exact);
  report(t, 'logistic-growth', printed.length, vsRecurrence, vsExact);

  assert.equal(printed.length, 401);
  assert.ok(vsRecurrence <= PRINT_ROUNDING, `off the recurrence by ${vsRecurrence}`);
  assert.ok(vsExact > 0.01 && vsExact < 0.1, `Euler error ${vsExact}`);
});

test('two tanks in series, with the inflow cut where the listing actually cuts it', async (t) => {
  const J0 = 50, K1 = 0.15, K2 = 0.05, DT = 0.25;
  const printed = await runListing('two-tank');

  // `IF T > 40 THEN LET J = 0` runs after the update, so the step that starts at
  // T = 40.25 still uses J = 50: the inflow stops at t = 40.5, not at the t = 40
  // the listing announces. The exact solution is taken with the listing's cut-off.
  const CUT = 40.5;

  function exactAt(T: number): [number, number] {
    const phase1 = (s: number): [number, number] => {
      const c = J0 / (K1 - K2);
      const q1 = (J0 / K1) * (1 - Math.exp(-K1 * s));
      const q2 = J0 / K2 + c * Math.exp(-K1 * s) - (J0 / K2 + c) * Math.exp(-K2 * s);
      return [q1, q2];
    };
    if (T <= CUT) return phase1(T);
    const [q1c, q2c] = phase1(CUT);
    const s = T - CUT;
    const f = (K1 * q1c) / (K2 - K1);
    return [q1c * Math.exp(-K1 * s), f * Math.exp(-K1 * s) + (q2c - f) * Math.exp(-K2 * s)];
  }

  const recurrence: Row[] = [];
  const exact: Row[] = [];
  let q1 = 0, q2 = 0, J = J0;
  for (let T = 0; T <= 80; T += DT) {
    const f1 = K1 * q1;
    const f2 = K2 * q2;
    recurrence.push([T, q1, q2]);
    exact.push([T, ...exactAt(T)]);
    q1 = q1 + (J - f1) * DT;
    q2 = q2 + (f1 - f2) * DT;
    if (T > 40) J = 0;
  }

  const vsRecurrence = maxAbs(printed, recurrence);
  const vsExact = maxScaled(recurrence, exact);
  report(t, 'two-tank', printed.length, vsRecurrence, vsExact);

  assert.equal(printed.length, 321);
  assert.ok(vsRecurrence <= PRINT_ROUNDING, `off the recurrence by ${vsRecurrence}`);
  assert.ok(vsExact > 0.001 && vsExact < 0.05, `Euler error ${vsExact}`);
});
