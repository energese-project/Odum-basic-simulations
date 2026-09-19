import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CGA, Screen } from './screen.ts';

/**
 * The IBM PC screen the listings drew on, rebuilt from what they drew. The
 * published figures are photographs or printouts of this screen, so it is the
 * thing a reproduction is compared against.
 */

function lit(screen: Screen): [number, number][] {
  const points: [number, number][] = [];
  for (let y = 0; y < screen.height; y++) {
    for (let x = 0; x < screen.width; x++) if (screen.pixel(x, y) !== 0) points.push([x, y]);
  }
  return points;
}

function mode1(): Screen {
  const screen = new Screen();
  screen.apply({ op: 'screen', mode: 1 });
  return screen;
}

test('SCREEN 1 is 320 by 200, all background', () => {
  const screen = mode1();
  assert.equal(screen.width, 320);
  assert.equal(screen.height, 200);
  assert.deepEqual(lit(screen), []);
});

test('SCREEN 2 is 640 by 200', () => {
  const screen = new Screen();
  screen.apply({ op: 'screen', mode: 2 });
  assert.equal(screen.width, 640);
  assert.equal(screen.height, 200);
});

test('PSET lights the pixel nearest the point the program computed', () => {
  const screen = mode1();
  screen.apply({ op: 'pset', x: 10.4, y: 173.6, color: 2, line: 20 });
  assert.deepEqual(lit(screen), [[10, 174]]);
  assert.equal(screen.pixel(10, 174), 2);
});

test('a point off the screen is clipped, not wrapped', () => {
  const screen = mode1();
  for (const [x, y] of [[-1, 5], [320, 5], [5, -1], [5, 200], [1e9, 1e9]]) {
    screen.apply({ op: 'pset', x, y, color: 1, line: 10 });
  }
  assert.deepEqual(lit(screen), []);
});

test('LINE lights every pixel between its ends, and clips what runs off', () => {
  // Line 7 of Table 3: (0,50)-(320,50). Column 320 is off a 320-wide screen.
  const screen = mode1();
  screen.apply({ op: 'line', x1: 0, y1: 50, x2: 320, y2: 50, color: 3, box: null, line: 7 });
  const points = lit(screen);
  assert.equal(points.length, 320);
  assert.ok(points.every(([, y]) => y === 50));
});

test('a sloping line is one connected run of pixels from end to end', () => {
  const screen = mode1();
  screen.apply({ op: 'line', x1: 0, y1: 0, x2: 9, y2: 3, color: 1, box: null, line: 10 });
  const points = lit(screen).sort((a, b) => a[0] - b[0]);
  assert.equal(points.length, 10, 'one pixel per column for a shallow line');
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points.at(-1), [9, 3]);
  for (let i = 1; i < points.length; i++) assert.ok(Math.abs(points[i][1] - points[i - 1][1]) <= 1);
});

test('B draws the edges of a box, and BF fills it', () => {
  // Line 6 of both listings: the frame round the plot.
  const screen = mode1();
  screen.apply({ op: 'line', x1: 0, y1: 0, x2: 319, y2: 180, color: 3, box: 'B', line: 6 });
  for (const [x, y] of [[0, 0], [319, 0], [0, 180], [319, 180], [160, 0], [0, 90], [319, 90], [160, 180]]) {
    assert.equal(screen.pixel(x, y), 3, `edge pixel ${x},${y}`);
  }
  assert.equal(screen.pixel(160, 90), 0, 'the inside is left alone');
  assert.equal(screen.pixel(160, 190), 0, 'nothing below the box');

  const filled = mode1();
  filled.apply({ op: 'line', x1: 2, y1: 2, x2: 4, y2: 3, color: 1, box: 'BF', line: 8 });
  assert.equal(lit(filled).length, 6);
});

test('CLS and SCREEN clear what was drawn', () => {
  const screen = mode1();
  screen.apply({ op: 'pset', x: 1, y: 1, color: 1, line: 10 });
  screen.apply({ op: 'cls' });
  assert.deepEqual(lit(screen), []);
  screen.apply({ op: 'pset', x: 1, y: 1, color: 1, line: 10 });
  screen.apply({ op: 'screen', mode: 1 });
  assert.deepEqual(lit(screen), []);
});

test('COLOR 0,0 is palette 0 on black: green, red and brown', () => {
  const screen = mode1();
  screen.apply({ op: 'color', background: 0, palette: 0 });
  assert.deepEqual(screen.colours(), [CGA[0], CGA[2], CGA[4], CGA[6]]);
});

test('palette 1 is cyan, magenta and white', () => {
  const screen = mode1();
  screen.apply({ op: 'color', background: 1, palette: 1 });
  assert.deepEqual(screen.colours(), [CGA[1], CGA[3], CGA[5], CGA[7]]);
});

test('the screen becomes RGBA pixels in the colours of its palette', () => {
  const screen = mode1();
  screen.apply({ op: 'color', background: 0, palette: 0 });
  screen.apply({ op: 'pset', x: 1, y: 0, color: 2, line: 10 });
  const rgba = screen.rgba();
  assert.equal(rgba.length, 320 * 200 * 4);
  assert.deepEqual([...rgba.slice(0, 4)], [...CGA[0], 255]);
  assert.deepEqual([...rgba.slice(4, 8)], [...CGA[4], 255]);
});

test('a line from far off the screen is drawn only where it crosses it', () => {
  const screen = mode1();
  screen.apply({ op: 'line', x1: -32000, y1: -32000, x2: 32000, y2: 32000, color: 1, box: null, line: 10 });
  assert.equal(screen.pixel(0, 0), 1);
  assert.equal(screen.pixel(199, 199), 1);
  assert.equal(lit(screen).length, 200);
});

test('a point or a line that is not a number draws nothing, and ends', () => {
  // Math.round(NaN) is NaN, and a line walked towards NaN never arrives.
  const screen = mode1();
  screen.apply({ op: 'line', x1: 0, y1: 0, x2: NaN, y2: 5, color: 1, box: null, line: 10 });
  screen.apply({ op: 'line', x1: 0, y1: 0, x2: 5, y2: Infinity, color: 1, box: 'B', line: 10 });
  screen.apply({ op: 'pset', x: NaN, y: 1, color: 1, line: 10 });
  assert.deepEqual(lit(screen), []);
});

test('a line that misses the screen entirely draws nothing', () => {
  const screen = mode1();
  screen.apply({ op: 'line', x1: -50, y1: -10, x2: 400, y2: -1, color: 1, box: null, line: 10 });
  assert.deepEqual(lit(screen), []);
});

test('a filled box far larger than the screen fills the screen, and ends', () => {
  // Walking the whole 65536-square box takes seconds; the screen's share of it
  // takes about a millisecond. The budget sits far from both.
  const screen = mode1();
  const start = performance.now();
  screen.apply({ op: 'line', x1: -32768, y1: -32768, x2: 32767, y2: 32767, color: 2, box: 'BF', line: 10 });
  assert.ok(performance.now() - start < 500, `${Math.round(performance.now() - start)}ms`);
  assert.equal(lit(screen).length, 320 * 200);
});
