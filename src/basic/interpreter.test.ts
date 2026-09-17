import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Basic } from './interpreter.ts';

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
