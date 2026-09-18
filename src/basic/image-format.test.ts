import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffImage } from './image-format.ts';

test('an image is identified by its first bytes, not its name', () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'png');
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), 'jpg');
  const webp = new Uint8Array(12);
  webp.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  webp.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  assert.equal(sniffImage(webp), 'webp');
});

test('anything else — a PDF, a HEIC, an empty file — is not an image here', () => {
  assert.equal(sniffImage(new TextEncoder().encode('%PDF-1.7')), null);
  assert.equal(sniffImage(new Uint8Array(0)), null);
});
