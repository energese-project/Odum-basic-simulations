import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrawReader, psetArguments } from './draw-plot.ts';
import { thinPlot, toCsv } from './output.ts';
import type { DrawOp } from './interpreter.ts';

// The plotting part of Odum's MACROEC (1989, Table 2): income Y and assets K,
// each PSET against time in screen coordinates.
const MACROEC = [
  '5  SCREEN 1,0:COLOR 0,0',
  '6  LINE (0,0)-(319,180),3,B',
  '230  PSET (T / T0,180 - Y / Y0),1',
  '255  IF K / KZ > 160 GOTO 300',
  '260  PSET (T / T0,180 - K / KZ),2',
  '450  END',
].join('\n');

const pset = (line: number, x: number, y: number): DrawOp => ({ op: 'pset', x, y, color: 1, line });

test("a PSET's arguments are read from the listing, nested parentheses and all", () => {
  assert.deepEqual(psetArguments('230  PSET (T / T0,180 - Y / Y0),1'), { x: 'T / T0', y: '180 - Y / Y0' });
  assert.deepEqual(psetArguments('10 PSET (INT(X), (A + B) * 2)'), { x: 'INT(X)', y: '(A + B) * 2' });
  assert.equal(psetArguments('10 PRINT "PSET"'), null);
});

test('each PSET statement is a series, named by its line and what it plots', () => {
  const reader = new DrawReader(MACROEC);
  reader.push([pset(230, 0, 178), pset(260, 0, 175), pset(230, 0.3, 177.8), pset(260, 0.3, 174.9)]);
  const plot = reader.plot;
  assert.ok(plot);
  assert.equal(plot.xLabel, 'T / T0');
  assert.deepEqual(
    plot.series.map((s) => s.label),
    ['line 230: 180 - Y / Y0', 'line 260: 180 - K / KZ'],
  );
  assert.deepEqual(plot.series[0].points, [{ x: 0, y: 178 }, { x: 0.3, y: 177.8 }]);
});

test('the y axis is screen rows, reversed so that up on the PC is up on the chart', () => {
  const reader = new DrawReader(MACROEC);
  reader.push([pset(230, 0, 178)]);
  assert.equal(reader.plot?.yReversed, true);
  assert.match(reader.plot?.yLabel ?? '', /screen/);
});

test('a series may skip points: line 255 leaves K off the screen', () => {
  const reader = new DrawReader(MACROEC);
  reader.push([pset(230, 0, 178), pset(260, 0, 175), pset(230, 0.3, 177.8)]);
  const [y, k] = reader.plot!.series;
  assert.equal(y.points.length, 2);
  assert.equal(k.points.length, 1);
  assert.equal(reader.plot!.independent, true);
});

test('after CONT the points are a second run, and every series says which run it is', () => {
  const reader = new DrawReader(MACROEC);
  reader.push([pset(230, 0, 178), pset(260, 0, 175)]);
  reader.nextRun();
  reader.push([pset(230, 1, 178), pset(260, 1, 175)]);
  assert.deepEqual(
    reader.plot!.series.map((s) => s.label),
    [
      'line 230: 180 - Y / Y0, run 1',
      'line 260: 180 - K / KZ, run 1',
      'line 230: 180 - Y / Y0, run 2',
      'line 260: 180 - K / KZ, run 2',
    ],
  );
});

test('a CONT that plots nothing more adds no run', () => {
  const reader = new DrawReader(MACROEC);
  reader.push([pset(230, 0, 178)]);
  reader.nextRun();
  assert.deepEqual(reader.plot!.series.map((s) => s.label), ['line 230: 180 - Y / Y0']);
});

test('the frame and the mode are not data: a program that only draws them has nothing to plot', () => {
  const reader = new DrawReader(MACROEC);
  reader.push([
    { op: 'screen', mode: 1 },
    { op: 'color', background: 0, palette: 0 },
    { op: 'line', x1: 0, y1: 0, x2: 319, y2: 180, color: 3, box: 'B', line: 6 },
  ]);
  assert.equal(reader.plot, null);
});

test('drawn points go to CSV as one row per point: run, line, x, y', () => {
  const reader = new DrawReader(MACROEC);
  reader.push([pset(230, 0, 178), pset(260, 0, 175)]);
  reader.nextRun();
  reader.push([pset(230, 1, 176.5)]);
  assert.equal(toCsv(reader.plot!), 'run,line,x,y\n1,230,0,178\n1,260,0,175\n2,230,1,176.5\n');
});

test('drawn series are thinned each on its own, keeping their ends and extremes', () => {
  const reader = new DrawReader(MACROEC);
  const ops: DrawOp[] = [];
  for (let i = 0; i < 1000; i++) ops.push(pset(230, i, 100 + (i === 500 ? -90 : 0)));
  ops.push(pset(260, 0, 175), pset(260, 1, 174));
  reader.push(ops);
  const thin = thinPlot(reader.plot!, 100);
  const [y, k] = thin.series;
  assert.ok(y.points.length <= 100);
  assert.deepEqual(y.points[0], { x: 0, y: 100 });
  assert.deepEqual(y.points.at(-1), { x: 999, y: 100 });
  assert.ok(y.points.some((p) => p.y === 10), 'the extreme at x = 500 survives');
  assert.equal(k.points.length, 2);
});

test('the points read as a table for the output pane', () => {
  const reader = new DrawReader(MACROEC);
  reader.push([pset(230, 0, 178), pset(260, 0.3, 174.9)]);
  assert.deepEqual(reader.table().split('\n').slice(0, 3), [
    'RUN   LINE   X             Y',
    ' 1    230    0             178',
    ' 1    260    0.3           174.9',
  ]);
});

test('single-precision values are shown to seven digits, and never run into the next column', () => {
  const reader = new DrawReader(MACROEC);
  reader.push([pset(260, 317.49932861328125, 80.17952728271484)]);
  assert.equal(reader.table().split('\n')[1], ' 1    260    317.4993      80.17953');
});
