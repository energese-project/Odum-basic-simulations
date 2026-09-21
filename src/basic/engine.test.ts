import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { instantiateEngine, type Engine } from './engine.ts';

/**
 * The committed engine.wasm, exercised as the browser exercises it.
 *
 * These read the binary that ships, not a freshly compiled one: if `make wasm`
 * is not rerun after a change to engine/, this suite is what keeps the stale
 * artefact from passing unnoticed. `make wasm-check` proves the bytes follow
 * from the source; this proves the bytes do what the site needs.
 */

const bytes = readFileSync(new URL('./engine.wasm', import.meta.url));

async function engine(): Promise<Engine> {
  // A fresh instance per test: the engine allocates, and a leak in one case
  // should not be something a later case silently depends on.
  return instantiateEngine(bytes);
}

test('a valid listing produces no diagnostics', async () => {
  const bas = await engine();
  assert.deepEqual(bas.validate('10 PRINT 1\n20 END\n'), []);
});

test('a syntax error is reported where it is', async () => {
  const bas = await engine();
  const [first, ...rest] = bas.validate('10 PRINT (1 + \n20 END\n');
  assert.equal(rest.length, 0, 'one broken line should not cascade into many');
  assert.ok(first, 'an unclosed expression must be reported');
  assert.equal(first.severity, 'error');
  assert.equal(first.startLineNumber, 1);
  assert.ok(first.message.length > 0, 'a diagnostic without a message helps nobody');
  assert.match(first.code, /^BAS\d+$/, 'every diagnostic carries a stable code');
});

test('the columns are 1-based and the end is exclusive, as Monaco means them', async () => {
  const bas = await engine();
  const [first] = bas.validate('10 NEXT\n');
  assert.ok(first);
  assert.ok(first.startColumn >= 1, 'column 0 would mean Monaco underlines the wrong place');
  assert.ok(first.endColumn > first.startColumn, 'an empty range underlines nothing');
  assert.ok(first.endLineNumber >= first.startLineNumber);
});

test('validation does not execute the listing', async () => {
  const bas = await engine();
  // An endless loop is a valid program. If validate() ran it, this would hang
  // rather than return — which is the property the editor depends on.
  assert.deepEqual(bas.validate('10 GOTO 10\n'), []);
});

test('the same instance validates repeatedly without leaking or corrupting', async () => {
  const bas = await engine();
  const broken = '10 PRINT (1 + \n';
  // Every keystroke calls this. A pointer mistake in the marshalling shows up
  // as drift across repeats rather than as a first-call failure.
  for (let i = 0; i < 200; i++) {
    assert.equal(bas.validate(broken).length, 1);
    assert.deepEqual(bas.validate('10 END\n'), []);
  }
});

test('a source large enough to grow the heap still validates', async () => {
  const bas = await engine();
  // Memory growth detaches every existing view; a cached Uint8Array would read
  // from a dead buffer here and either throw or return nonsense.
  const long = Array.from({ length: 20_000 }, (_, i) => `${i + 1} PRINT ${i}`).join('\n');
  assert.deepEqual(bas.validate(long), []);
});

test('the engine reports its version', async () => {
  const bas = await engine();
  assert.match(bas.version, /^\d+\.\d+\.\d+$/);
});

test('a program runs to completion and prints what the machine would show', async () => {
  const bas = await engine();
  const program = bas.load('10 PRINT "T", "Q"\n20 PRINT 1, 2\n30 END\n');
  let guard = 0;
  while (program.step(256) === 'more' && guard++ < 1000);
  // The text is the console's; the rows are the same numbers for comparison.
  // The trailing space after the 2 is the number's own; "Q" is a string and
  // carries none. That asymmetry is GW-BASIC's, recorded in runs/print.txt.
  assert.equal(program.takeText(), 'T             Q\n 1             2 \n');
  assert.equal(program.rows().length, 2);
  program.free();
});

test('takeText drains, so a stepping loop sees a stream rather than a repeat', async () => {
  const bas = await engine();
  const program = bas.load('10 PRINT 1\n20 PRINT 2\n30 END\n');
  const seen: string[] = [];
  let guard = 0;
  for (;;) {
    const result = program.step(1);
    seen.push(program.takeText());
    if (result !== 'more' || guard++ > 100) break;
  }
  assert.equal(seen.join(''), ' 1 \n 2 \n');
  program.free();
});

test('graphics become rows in the program\'s own coordinates', async () => {
  const bas = await engine();
  const program = bas.load('10 SCREEN 1\n20 PSET (10, 20), 3\n30 LINE (0,0)-(9,9),2,B\n40 END\n');
  let guard = 0;
  while (program.step(256) === 'more' && guard++ < 1000);
  const drawn = program.rows().filter((r) => r.kind !== 'print');
  assert.deepEqual(
    drawn.map((r) => [r.kind, r.x, r.y, r.color, r.box]),
    [
      ['pset', 10, 20, 3, null],
      ['line', 9, 9, 2, 'B'],
    ],
  );
  program.free();
});

test('INPUT suspends and resumes across the wasm boundary', async () => {
  const bas = await engine();
  const program = bas.load('10 INPUT "YOUR GUESS"; G\n20 PRINT G\n30 END\n');
  assert.equal(program.step(256), 'awaiting-input');
  assert.equal(program.inputPrompt(), 'YOUR GUESS');
  assert.equal(program.provideInput('21'), true);
  let guard = 0;
  while (program.step(256) === 'more' && guard++ < 1000);
  assert.equal(program.takeText(), ' 21 \n');
  program.free();
});

test('a line short of values leaves the program waiting', async () => {
  const bas = await engine();
  const program = bas.load('10 INPUT A, B\n20 END\n');
  assert.equal(program.step(256), 'awaiting-input');
  assert.equal(program.provideInput('3'), false, 'one value cannot satisfy two variables');
  assert.equal(program.provideInput('4'), true);
  assert.equal(program.step(256), 'halted');
  program.free();
});

test('END stops the program and CONT carries it on', async () => {
  const bas = await engine();
  const program = bas.load('10 PRINT 1\n20 END\n30 PRINT 2\n40 END\n');
  let guard = 0;
  while (program.step(256) === 'more' && guard++ < 1000);
  assert.equal(program.takeText(), ' 1 \n');
  assert.equal(program.canContinue(), true);
  program.cont();
  guard = 0;
  while (program.step(256) === 'more' && guard++ < 1000);
  assert.equal(program.takeText(), ' 2 \n');
  program.free();
});

test('a runtime failure is reported with its line', async () => {
  const bas = await engine();
  const program = bas.load('10 DIM A(3)\n20 END\n');
  assert.equal(program.step(256), 'failed');
  const failure = program.error();
  assert.ok(failure, 'a failed program must say why');
  assert.equal(failure.line, 10);
  program.free();
});

test('using a freed program is refused rather than reading freed memory', async () => {
  const bas = await engine();
  const program = bas.load('10 END\n');
  program.free();
  program.free();   // idempotent
  assert.throws(() => program.step(1), /freed/);
});

test('the charge-and-discharge listing runs and prints its table', async () => {
  const bas = await engine();
  const dir = new URL('../../programs/', import.meta.url);
  const program = bas.load(readFileSync(new URL('charge-discharge.bas', dir), 'utf8'));
  let text = '';
  let guard = 0;
  for (;;) {
    const result = program.step(4096);
    text += program.takeText();
    if (result !== 'more') break;
    if (guard++ > 1000) throw new Error('did not terminate');
  }
  // The header the listing prints, and the steady state it reports at the end.
  assert.match(text, /^T {13}Q {13}OUTFLOW/);
  assert.match(text, /STEADY STATE J\/K1 = 1000/);
  // 121 rows of three columns, as the article's validation table says.
  assert.equal(program.rows().filter((r) => r.kind === 'print').length, 121 * 3 + 1);
  program.free();
});

test('every published listing validates clean', async () => {
  const bas = await engine();
  const dir = new URL('../../programs/', import.meta.url);
  const listings = readdirSync(dir).filter((f) => f.endsWith('.bas'));

  // Not a sample of one. guess.bas was accused by the editor for as long as
  // the checker shipped, because the test covering this ran charge-discharge
  // and stopped there. The archive is small; check all of it.
  assert.ok(listings.length >= 5, 'the archive should not have shrunk');

  const accused = listings
    .map((file) => ({
      file,
      diagnostics: bas.validate(readFileSync(new URL(file, dir), 'utf8')),
    }))
    .filter((r) => r.diagnostics.length > 0);

  assert.deepEqual(
    accused.map((r) => `${r.file}: ${r.diagnostics[0].message}`),
    [],
    'the checker must not accuse a published listing',
  );
});
