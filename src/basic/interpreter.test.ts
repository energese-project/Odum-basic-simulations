import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Basic, type DrawOp } from './interpreter.ts';

/** Run a listing to completion and return everything it printed. */
async function run(source: string, input: string[] = []): Promise<string> {
  let out = '';
  const queued = [...input];
  const interp = new Basic({
    print: (t) => {
      out += t;
    },
    requestInput: async () => queued.shift() ?? '',
  });
  interp.load(source);
  await interp.run();
  return out;
}

test('PRINT emits a leading space for non-negative numbers', async () => {
  assert.equal(await run('10 PRINT 5'), ' 5\n');
  assert.equal(await run('10 PRINT -5'), '-5\n');
});

test('a comma in PRINT becomes a tab and a trailing one suppresses the newline', async () => {
  assert.equal(await run('10 PRINT 1, 2'), ' 1\t 2\n');
  assert.equal(await run('10 PRINT 1,\n20 PRINT 2'), ' 1\t 2\n');
});

test('FOR/NEXT counts, including a fractional STEP', async () => {
  assert.equal(await run('10 FOR I = 1 TO 3\n20 PRINT I\n30 NEXT I'), ' 1\n 2\n 3\n');
  assert.equal(await run('10 FOR I = 0 TO 1 STEP 0.5\n20 PRINT I\n30 NEXT I'), ' 0\n 0.5\n 1\n');
});

test('a negative STEP terminates on the lower bound', async () => {
  assert.equal(await run('10 FOR I = 3 TO 1 STEP -1\n20 PRINT I\n30 NEXT I'), ' 3\n 2\n 1\n');
});

test('nested loops unwind without leaking frames', async () => {
  const out = await run(
    '10 FOR I = 1 TO 2\n20 FOR J = 1 TO 2\n30 PRINT I; J\n40 NEXT J\n50 NEXT I'
  );
  assert.equal(out, ' 1 1\n 1 2\n 2 1\n 2 2\n');
});

test('GOSUB returns to the statement after the call, mid-line', async () => {
  const out = await run('10 GOSUB 100: PRINT "B"\n20 END\n100 PRINT "A"\n110 RETURN');
  assert.equal(out, 'A\nB\n');
});

test('IF/THEN takes a bare line number as a GOTO', async () => {
  assert.equal(await run('10 IF 1 = 1 THEN 100\n20 PRINT "NO"\n30 END\n100 PRINT "YES"'), 'YES\n');
});

test('implicit LET assigns without the keyword', async () => {
  assert.equal(await run('10 X = 4\n20 PRINT X'), ' 4\n');
});

test('DATA/READ walks the whole program in line order, and RESTORE rewinds', async () => {
  const out = await run('10 DATA 1, 2\n20 READ A, B\n30 RESTORE\n40 READ C\n50 PRINT A; B; C');
  assert.equal(out, ' 1 2 1\n');
});

test('arrays work undimensioned and dimensioned', async () => {
  assert.equal(await run('10 A(3) = 7\n20 PRINT A(3)'), ' 7\n');
  assert.equal(await run('10 DIM B(2,2)\n20 B(1,2) = 9\n30 PRINT B(1,2)'), ' 9\n');
});

test('string variables and functions', async () => {
  assert.equal(await run('10 A$ = "HELLO"\n20 PRINT LEFT$(A$, 2); MID$(A$, 2, 3)'), 'HEELL\n');
});

test('INPUT reads a line and splits it on commas', async () => {
  const out = await run('10 INPUT "N"; A, B\n20 PRINT A + B', ['3,4']);
  assert.equal(out, 'N?  7\n');
});

test('EXP and LOG are available — most of the published models need them', async () => {
  assert.equal(await run('10 PRINT EXP(0); LOG(1)'), ' 1 0\n');
  assert.equal(await run('10 PRINT INT(EXP(1) * 1000)'), ' 2718\n');
});

test('exponents in numeric literals parse as one token', async () => {
  assert.equal(await run('10 K = 1E-3\n20 PRINT K * 1000'), ' 1\n');
});

test('a colon inside REM is comment text, not a statement separator', async () => {
  // Prose comments are how the listings are headed, and they punctuate.
  assert.equal(await run('10 REM note: this is prose\n20 PRINT "OK"'), 'OK\n');
});

test('a colon still separates statements outside a REM', async () => {
  assert.equal(await run('10 PRINT "A": PRINT "B"'), 'A\nB\n');
  assert.equal(await run('10 PRINT "A:B"'), 'A:B\n');
});

test('RANDOMIZE is accepted, so listings that open with it still run', async () => {
  assert.equal(await run('10 RANDOMIZE\n20 PRINT "OK"'), 'OK\n');
});

test('an error reports the line it happened on and stops the program', async () => {
  const out = await run('10 PRINT "A"\n20 GOTO 999\n30 PRINT "B"');
  assert.match(out, /UNDEF'D STATEMENT ERROR IN LINE 20/);
  assert.doesNotMatch(out, /B/);
});

test('shouldHalt stops a program that would otherwise never end', async () => {
  let out = '';
  let steps = 0;
  const interp = new Basic({
    print: (t) => {
      out += t;
    },
    // Halt at the first yield point the interpreter offers.
    shouldHalt: () => ++steps > 0,
  });
  interp.load('10 X = X + 1\n20 GOTO 10');
  await interp.run();
  assert.equal(out, '');
  assert.ok(steps > 0, 'the run loop never reached a yield point');
});

test('a charge-and-discharge model converges on the steady state J/K1', async () => {
  const out = await run(
    [
      '10 J = 100',
      '20 K1 = 0.1',
      '30 Q = 0',
      '40 FOR T = 0 TO 400 STEP 0.5',
      '50 Q = Q + (J - K1 * Q) * 0.5',
      '60 NEXT T',
      '70 PRINT Q',
    ].join('\n')
  );
  // Approached from below and never reached, so this is a tolerance, not an
  // equality — INT(Q) here would be 999.
  assert.ok(Math.abs(Number(out.trim()) - 1000) < 0.001, `converged to ${out.trim()}`);
});

test('IF without THEN takes a GOTO, as the 1989 Simulation listings write it', async () => {
  // "IF Y / Y0 > 160 GOTO 450" — no THEN. IBM PC BASIC accepted it.
  assert.equal(await run('10 IF 2 > 1 GOTO 30\n20 PRINT "NO"\n30 PRINT "YES"'), 'YES\n');
  assert.equal(await run('10 IF 1 > 2 GOTO 30\n20 PRINT "NO"\n30 PRINT "YES"'), 'NO\nYES\n');
});

// ------------------------------------------------------------------ graphics
//
// The later listings draw instead of printing. What they draw is recorded as
// operations in screen coordinates, exactly as the program computed them, with
// the line that drew each one — the screen is rendered from that record, and a
// plot can be compared with the published figure in the same coordinates.

/** Run a listing and return what it drew, and what it printed. */
async function draw(source: string): Promise<{ ops: DrawOp[]; out: string }> {
  const ops: DrawOp[] = [];
  let out = '';
  const interp = new Basic({ print: (t) => (out += t), draw: (op) => ops.push(op) });
  interp.load(source);
  await interp.run();
  return { ops, out };
}

test('SCREEN, COLOR and CLS are recorded as the screen is set up', async () => {
  const { ops } = await draw('4 CLS\n5 SCREEN 1,0: COLOR 0,0');
  assert.deepEqual(ops, [
    { op: 'cls' },
    { op: 'screen', mode: 1 },
    { op: 'color', background: 0, palette: 0 },
  ]);
});

test('PSET records the point the program computed, its colour, and its line', async () => {
  const { ops } = await draw('5 SCREEN 1\n10 T = 21: T0 = 2\n20 PSET (T / T0, 180 - 3 / .5), 2');
  assert.deepEqual(ops.at(-1), { op: 'pset', x: 10.5, y: 174, color: 2, line: 20 });
});

test('a point with no colour is drawn in the foreground; PRESET in the background', async () => {
  const { ops } = await draw('5 SCREEN 1\n10 PSET (1, 1)\n20 PRESET (2, 2)\n30 SCREEN 2\n40 PSET (3, 3)');
  assert.deepEqual(
    ops.filter((o) => o.op === 'pset').map((o) => (o as { color: number }).color),
    [3, 0, 1]
  );
});

test('LINE draws between two points, and as a box with B or BF', async () => {
  const { ops } = await draw(
    '5 SCREEN 1\n6 LINE (0,0)-(319,180),3,B\n7 LINE (0,50) -(320,50),3\n8 LINE (1,2)-(3,4),,BF'
  );
  assert.deepEqual(ops.slice(1), [
    { op: 'line', x1: 0, y1: 0, x2: 319, y2: 180, color: 3, box: 'B', line: 6 },
    { op: 'line', x1: 0, y1: 50, x2: 320, y2: 50, color: 3, box: null, line: 7 },
    { op: 'line', x1: 1, y1: 2, x2: 3, y2: 4, color: 3, box: 'BF', line: 8 },
  ]);
});

test('LINE with no first point starts from the last point drawn, and STEP is relative to it', async () => {
  const { ops } = await draw('5 SCREEN 1\n10 PSET (5, 5)\n20 LINE -(10, 10)\n30 LINE STEP(1,1)-STEP(2,0)\n40 PSET STEP(0, -3)');
  assert.deepEqual(ops.slice(2), [
    { op: 'line', x1: 5, y1: 5, x2: 10, y2: 10, color: 3, box: null, line: 20 },
    { op: 'line', x1: 11, y1: 11, x2: 13, y2: 11, color: 3, box: null, line: 30 },
    { op: 'pset', x: 13, y: 8, color: 3, line: 40 },
  ]);
});

test('drawing before SCREEN is an error, as it was in text mode on the PC', async () => {
  const { ops, out } = await draw('10 PSET (1, 1)');
  assert.deepEqual(ops, []);
  assert.match(out, /ILLEGAL FUNCTION CALL ERROR IN LINE 10/);
});

test('a colour the screen mode does not have is an error, not a guess', async () => {
  assert.match((await draw('5 SCREEN 1\n10 PSET (1, 1), 4')).out, /ILLEGAL FUNCTION CALL ERROR IN LINE 10/);
  assert.match((await draw('5 SCREEN 2\n10 LINE (0,0)-(1,1), 2')).out, /ILLEGAL FUNCTION CALL ERROR IN LINE 10/);
});

test('a screen mode the interpreter cannot draw is refused by name', async () => {
  assert.match((await draw('10 SCREEN 9')).out, /SCREEN 9 NOT SUPPORTED ERROR IN LINE 10/);
});

test('without a screen to draw on, drawing is still checked and then dropped', async () => {
  // Under node --test, and anywhere else with no draw callback.
  assert.equal(await run('10 SCREEN 1\n20 PSET (1,1), 2\n30 PRINT "DONE"'), 'DONE\n');
});

// ---------------------------------------------------------------------- CONT
//
// Table 2 of Odum (1989) ENDs after its first run and says "type CONT for run
// with renewable resources": the second figure is drawn by carrying on past END.

test('CONT carries on after END, with the variables as they were', async () => {
  let out = '';
  const interp = new Basic({ print: (t) => (out += t) });
  interp.load('10 X = 1\n20 PRINT X\n30 END\n40 X = X + 1\n50 PRINT X');
  await interp.run();
  assert.equal(out, ' 1\n');
  assert.equal(interp.canContinue, true);
  await interp.cont();
  assert.equal(out, ' 1\n 2\n');
  assert.equal(interp.canContinue, false, 'it ran off the end: nothing is left to continue');
});

test('CONT carries on after STOP, from the next statement on the line', async () => {
  let out = '';
  const interp = new Basic({ print: (t) => (out += t) });
  interp.load('10 PRINT 1: STOP: PRINT 2');
  await interp.run();
  await interp.cont();
  assert.equal(out, ' 1\n 2\n');
});

test('there is nothing to continue after an error', async () => {
  let out = '';
  const interp = new Basic({ print: (t) => (out += t) });
  interp.load('10 GOTO 99\n20 PRINT "NEVER"');
  await interp.run();
  assert.equal(interp.canContinue, false);
  await interp.cont();
  assert.match(out, /\?CAN'T CONTINUE/);
  assert.doesNotMatch(out, /NEVER/);
});

test('a coordinate the PC could not hold is an overflow, as a diverging model hits', async () => {
  // A run that blows up computes 180 - Y / Y0 with Y in the millions; the PC's
  // graphics coordinates were 16-bit integers.
  assert.match((await draw('5 SCREEN 1\n10 PSET (1, 1E6)')).out, /OVERFLOW ERROR IN LINE 10/);
  assert.match((await draw('5 SCREEN 1\n10 LINE (0, 0)-(40000, 1)')).out, /OVERFLOW ERROR IN LINE 10/);
  assert.match((await draw('5 SCREEN 1\n10 PSET (LOG(-1), 1)')).out, /ERROR IN LINE 10/);
});
