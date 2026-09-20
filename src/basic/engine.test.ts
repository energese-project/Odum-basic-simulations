import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
