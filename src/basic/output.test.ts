import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TableReader, extractPlot, thinPlot, toCsv, type Plot } from './output.ts';

test('a table of numbers becomes one series per column after the first', () => {
  const plot = extractPlot(' 0\t 0\n 1\t 10\n 2\t 20\n');
  assert.ok(plot);
  assert.equal(plot.series.length, 1);
  assert.deepEqual(plot.series[0].points, [
    { x: 0, y: 0 },
    { x: 1, y: 10 },
    { x: 2, y: 20 },
  ]);
});

test('a non-numeric line above the table supplies the column names', () => {
  const plot = extractPlot('T\tQ\tOUTFLOW\n 0\t 0\t 0\n 1\t 50\t 5\n');
  assert.ok(plot);
  assert.equal(plot.xLabel, 'T');
  assert.deepEqual(
    plot.series.map((s) => s.label),
    ['Q', 'OUTFLOW']
  );
});

test('columns are numbered when the line above is the wrong width', () => {
  const plot = extractPlot('RESULTS OF THE RUN FOLLOW\n 0\t 1\n 1\t 2\n');
  assert.ok(plot);
  assert.equal(plot.xLabel, 'X');
  assert.deepEqual(
    plot.series.map((s) => s.label),
    ['Column 2']
  );
});

test('columns are numbered when the table is the first thing printed', () => {
  const plot = extractPlot(' 0\t 1\n 1\t 2\n');
  assert.ok(plot);
  assert.equal(plot.xLabel, 'X');
});

test('prose the width of the table is read as a header — a known ambiguity', () => {
  // Nothing distinguishes `PRINT "RESULTS", "FOLLOW"` from `PRINT "T", "Q"`, so
  // the rule takes both. Pinned here so the behaviour is a decision rather than
  // a surprise: the cost is a mislabelled axis, and the fix is a header line in
  // the listing, not a cleverer guess.
  const plot = extractPlot('RESULTS FOLLOW\n 0\t 1\n 1\t 2\n');
  assert.ok(plot);
  assert.equal(plot.xLabel, 'RESULTS');
});

test('prose around the table is ignored', () => {
  const plot = extractPlot('STARTING RUN\n 0\t 1\n 1\t 2\n 2\t 3\nDONE\nSTEADY STATE = 1000\n');
  assert.ok(plot);
  assert.equal(plot.series[0].points.length, 3);
});

test('the longest run wins when a program prints more than one table', () => {
  const plot = extractPlot(' 0\t 1\n 1\t 2\nGAP\n 0\t 9\n 1\t 8\n 2\t 7\n 3\t 6\n');
  assert.ok(plot);
  assert.equal(plot.series[0].points.length, 4);
  assert.equal(plot.series[0].points[0].y, 9);
});

test('a change of column count splits the table rather than making it ragged', () => {
  const plot = extractPlot(' 0\t 1\t 2\n 1\t 2\t 3\n 0\t 1\n 1\t 2\n 2\t 3\n');
  assert.ok(plot);
  assert.equal(plot.series.length, 1, 'took the two-column block, which is longer');
  assert.equal(plot.series[0].points.length, 3);
});

test('nothing plottable returns null rather than an empty chart', () => {
  assert.equal(extractPlot('HELLO WORLD\nDONE\n'), null);
  assert.equal(extractPlot(' 1\n 2\n 3\n'), null, 'one column is not an x/y pair');
  assert.equal(extractPlot(' 0\t 1\n'), null, 'a single row is not a curve');
});

test('CSV round-trips the labels and the rows', () => {
  const plot = extractPlot('T\tQ\n 0\t 5\n 1\t 6\n');
  assert.ok(plot);
  assert.equal(toCsv(plot), 'T,Q\n0,5\n1,6\n');
});

// ---------------------------------------------------------------- read as it runs
//
// A run arrives in pieces — the worker flushes every 40ms — and used to be
// re-read from the top on every replot, which made a long run quadratic on the
// main thread: 60,000 rows kept the page busy for six seconds. TableReader
// reads each piece once. These tests pin that it reads the same table.

const TRANSCRIPTS = [
  'T\tQ\tOUTFLOW\n 0\t 0\t 0\n 1\t 50\t 5\n',
  'RESULTS OF THE RUN FOLLOW\n 0\t 1\n 1\t 2\n',
  'STARTING RUN\n 0\t 1\n 1\t 2\n 2\t 3\nDONE\nSTEADY STATE = 1000\n',
  ' 0\t 1\n 1\t 2\nGAP\n 0\t 9\n 1\t 8\n 2\t 7\n 3\t 6\n',
  ' 0\t 1\t 2\n 1\t 2\t 3\n 0\t 1\n 1\t 2\n 2\t 3\n',
  'A\tB\n 0\t 1\n 1\t 2\n\nC\tD\n 0\t 5\n 1\t 6\n',
  'X\tY\n 0\t 1\n 1\t 2',
  'HELLO WORLD\nDONE\n',
];

function readInPieces(text: string, cuts: number[]): TableReader {
  const reader = new TableReader();
  let from = 0;
  for (const cut of [...cuts, text.length]) {
    reader.push(text.slice(from, cut));
    from = cut;
  }
  reader.end();
  return reader;
}

test('read in pieces, the table is the one read whole, wherever the pieces split', () => {
  for (const text of TRANSCRIPTS) {
    const whole = extractPlot(text);
    for (let cut = 0; cut <= text.length; cut++) {
      assert.deepEqual(readInPieces(text, [cut]).plot, whole, `split at ${cut} of ${JSON.stringify(text)}`);
    }
    const everyCharacter = Array.from({ length: text.length }, (_, i) => i);
    assert.deepEqual(readInPieces(text, everyCharacter).plot, whole);
  }
});

test('a line still being printed is not read until it ends', () => {
  const reader = new TableReader();
  reader.push('T\tQ\n 0\t 1\n 1\t 2\n 2\t');
  assert.equal(reader.plot?.series[0].points.length, 2);
  reader.push(' 3\n');
  assert.equal(reader.plot?.series[0].points.length, 3);
  assert.deepEqual(reader.plot?.series[0].points[2], { x: 2, y: 3 });
});

test('the plot grows in place while its table does, and stays the same plot', () => {
  const reader = new TableReader();
  reader.push('T\tQ\n 0\t 1\n 1\t 2\n');
  const plot = reader.plot;
  const points = plot?.series[0].points;
  reader.push(' 2\t 3\n 3\t 4\n');
  assert.equal(reader.plot, plot);
  assert.equal(reader.plot?.series[0].points, points);
  assert.equal(points?.length, 4);
});

test('a later table becomes the plot once it is the longer one, and not before', () => {
  const reader = new TableReader();
  reader.push(' 0\t 1\n 1\t 2\n 2\t 3\nGAP\n 0\t 9\n 1\t 8\n');
  const first = reader.plot;
  reader.push(' 2\t 7\n');
  assert.equal(reader.plot, first, 'a tie goes to the earlier table, as it does read whole');
  reader.push(' 3\t 6\n');
  assert.notEqual(reader.plot, first);
  assert.equal(reader.plot?.series[0].points[0].y, 9);
});

test('a long run costs about the same read in pieces as read whole', () => {
  // The property the workbench depends on: each piece is read once. Reading
  // from the top on every piece is ~200x slower at this size, so the margin
  // here is wide enough not to flake on a slow runner.
  const rows = Array.from({ length: 20_000 }, (_, i) => ` ${i}\t ${i * 0.5}\t ${i * 2}\n`);
  const text = 'T\tQ\tF\n' + rows.join('');
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += 1_000) pieces.push(text.slice(i, i + 1_000));

  const time = (read: () => void): number => {
    read(); // warm up
    const start = performance.now();
    for (let i = 0; i < 3; i++) read();
    return performance.now() - start;
  };
  const whole = time(() => extractPlot(text));
  const inPieces = time(() => {
    const reader = new TableReader();
    for (const piece of pieces) {
      reader.push(piece);
      void reader.plot; // the workbench asks after every replot
    }
    reader.end();
  });
  assert.ok(inPieces < whole * 4 + 50, `in pieces ${inPieces.toFixed(0)}ms, whole ${whole.toFixed(0)}ms`);
});

// ------------------------------------------------------------ thinned for the chart
//
// Chart.js re-parses every point of every dataset on every update, so a
// 60,000-row run redrawn four times a second is a frozen tab however the rows
// arrive. The chart is given at most a few thousand rows; the CSV and the
// console keep them all.

function table(rows: number, ys: ((i: number) => number)[]): Plot {
  return {
    xLabel: 'T',
    series: ys.map((y, s) => ({
      label: `Q${s + 1}`,
      points: Array.from({ length: rows }, (_, i) => ({ x: i * 0.1, y: y(i) })),
    })),
  };
}

test('a table that fits is drawn row for row', () => {
  const plot = table(500, [(i) => i, (i) => -i]);
  assert.deepEqual(thinPlot(plot, 4000), plot);
});

test('a long table is thinned to the budget, keeping real rows in their order', () => {
  const plot = table(60_000, [(i) => Math.sin(i / 300), (i) => i % 977]);
  const thin = thinPlot(plot, 4000);
  const rows = thin.series[0].points.length;
  assert.ok(rows <= 4000, `${rows} rows`);
  assert.ok(rows > 1000, `${rows} rows is too coarse to draw`);

  const xs = thin.series[0].points.map((p) => p.x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], 'rows stay in order, none twice');

  // Every series keeps the same rows, so the tooltip's "every series at this x"
  // is still true — and each kept point is a row that was printed, not a blend.
  for (const [s, series] of thin.series.entries()) {
    assert.deepEqual(series.points.map((p) => p.x), xs);
    const printed = new Map(plot.series[s].points.map((p) => [p.x, p.y]));
    for (const p of series.points) assert.equal(p.y, printed.get(p.x));
  }
});

test('thinning keeps every extreme, the first row and the last', () => {
  // A single-row spike is exactly what naive every-nth sampling loses.
  const spike = (i: number) => (i === 31_337 ? 1e6 : i === 44_444 ? -1e6 : Math.cos(i / 50));
  const plot = table(60_000, [spike, (i) => i]);
  const thin = thinPlot(plot, 4000);
  const ys = thin.series[0].points.map((p) => p.y);
  assert.ok(ys.includes(1e6) && ys.includes(-1e6), 'the spike and the dip survive');
  assert.deepEqual(thin.series[0].points[0], plot.series[0].points[0]);
  assert.deepEqual(thin.series[0].points.at(-1), plot.series[0].points.at(-1));
});

test('thinning keeps the extremes of x too, where x is not the time column', () => {
  // A phase-plane listing prints Q1 against Q2: x doubles back on itself, and
  // the axis must still span all of it.
  const plot: Plot = {
    xLabel: 'Q1',
    series: [{
      label: 'Q2',
      points: Array.from({ length: 50_000 }, (_, i) => ({
        x: Math.cos(i / 700) * (1 + i / 50_000),
        y: Math.sin(i / 700),
      })),
    }],
  };
  const thin = thinPlot(plot, 4000);
  const xs = plot.series[0].points.map((p) => p.x);
  const kept = thin.series[0].points.map((p) => p.x);
  assert.equal(Math.max(...kept), Math.max(...xs));
  assert.equal(Math.min(...kept), Math.min(...xs));
});

test('thinning leaves the plot it was given alone', () => {
  const plot = table(10_000, [(i) => i]);
  const before = plot.series[0].points.length;
  thinPlot(plot, 1000);
  assert.equal(plot.series[0].points.length, before);
});
