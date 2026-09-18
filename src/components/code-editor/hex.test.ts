import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseHex } from './hex.ts';

test('six-digit hex passes through, lowercased and hashed', () => {
  assert.equal(normaliseHex('#14201F'), '#14201f');
  assert.equal(normaliseHex('14201f'), '#14201f');
  assert.equal(normaliseHex('  #14201f  '), '#14201f');
});

test('three-digit hex is expanded — the case that broke the production build', () => {
  // The minifier shortens --e-surface: #ffffff to #fff, and Monaco rejects it
  // with "Illegal value for token color", taking the whole editor down.
  assert.equal(normaliseHex('#fff'), '#ffffff');
  assert.equal(normaliseHex('#abc'), '#aabbcc');
  assert.equal(normaliseHex('#000'), '#000000');
});

test('alpha is dropped rather than blended', () => {
  assert.equal(normaliseHex('#14201fcc'), '#14201f');
  assert.equal(normaliseHex('#abcd'), '#aabbcc');
});

test('rgb() and rgba() are converted', () => {
  assert.equal(normaliseHex('rgb(20, 32, 31)'), '#14201f');
  assert.equal(normaliseHex('rgba(20, 32, 31, 0.5)'), '#14201f');
  assert.equal(normaliseHex('rgb(20 32 31)'), '#14201f');
});

test('out-of-range and fractional channels are clamped and rounded', () => {
  assert.equal(normaliseHex('rgb(300, -20, 127.6)'), '#ff0080');
});

test('anything unrecognised is null, not a wrong colour', () => {
  // A missing custom property reads back as '' from getComputedStyle. Returning
  // null lets the caller leave the key out so Monaco keeps its own default,
  // which is visibly plain rather than silently black.
  assert.equal(normaliseHex(''), null);
  assert.equal(normaliseHex('   '), null);
  assert.equal(normaliseHex('var(--e-ink)'), null);
  assert.equal(normaliseHex('currentColor'), null);
  assert.equal(normaliseHex('#12345'), null);
});
