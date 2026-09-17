import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPlot, toCsv } from './output.ts';
import { parseHeader } from './program-header.ts';

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

test('a program title and description come from its first two REMs', () => {
  const header = parseHeader('charge-discharge', '10 REM Charge And Discharge\n20 REM One tank.\n30 END');
  assert.equal(header.title, 'Charge And Discharge');
  assert.equal(header.description, 'One tank.');
});

test('a listing with no REM header falls back to its prettified filename', () => {
  const header = parseHeader('two-tank', '10 PRINT "HI"');
  assert.equal(header.title, 'Two Tank');
  assert.equal(header.description, '');
});

test('a REM below the first statement is a comment, not a header', () => {
  const header = parseHeader('x', '10 PRINT "HI"\n20 REM not a title');
  assert.equal(header.title, 'X');
});
