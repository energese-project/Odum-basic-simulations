import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArchiveError, readCatalog } from './program-archive.ts';
import { MetadataError } from './program-catalog.ts';

/**
 * These are the checks a contributor's pull request is judged by, so each test
 * is phrased as a mistake someone adding a program could actually make.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'odum-archive-'));
  mkdirSync(join(root, 'programs'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const META = JSON.stringify({
  title: 'A Program',
  description: 'Does a thing.',
  fidelity: 'original',
});

function add(name: string, content: string): void {
  writeFileSync(join(root, 'programs', name), content);
}

test('a program with its sidecar is catalogued, with the listing inline', () => {
  add('tank.bas', '10 PRINT 1\n');
  add('tank.json', META);

  const catalog = readCatalog(root, new Date('2026-01-01T00:00:00Z'));
  assert.equal(catalog.programs.length, 1);
  assert.equal(catalog.programs[0].id, 'tank');
  assert.equal(catalog.programs[0].file, 'tank.bas');
  assert.equal(catalog.programs[0].listing, '10 PRINT 1\n');
  assert.equal(catalog.programs[0].source, null, 'source is null, not absent, so it survives JSON');
  assert.equal(catalog.generated, '2026-01-01T00:00:00.000Z');
});

test('programs are sorted by id so the catalog is stable between builds', () => {
  for (const id of ['zeta', 'alpha', 'mid']) {
    add(`${id}.bas`, '10 END\n');
    add(`${id}.json`, META);
  }
  assert.deepEqual(
    readCatalog(root).programs.map((p) => p.id),
    ['alpha', 'mid', 'zeta']
  );
});

test('a listing added without a sidecar fails, naming the file', () => {
  add('tank.bas', '10 PRINT 1\n');
  assert.throws(() => readCatalog(root), ArchiveError);
  assert.throws(() => readCatalog(root), /programs\/tank\.bas/);
});

test('a sidecar left behind by a rename fails, naming the file', () => {
  add('tank.bas', '10 PRINT 1\n');
  add('tank.json', META);
  add('old-name.json', META);
  assert.throws(() => readCatalog(root), /Metadata with no program: programs\/old-name\.json/);
});

test('an invalid sidecar fails with the metadata error, not a generic one', () => {
  add('tank.bas', '10 PRINT 1\n');
  add('tank.json', JSON.stringify({ title: 'x', description: 'y', fidelity: 'verbatim' }));
  assert.throws(() => readCatalog(root), MetadataError);
  assert.throws(() => readCatalog(root), /"source" is required/);
});

test('filenames must be lowercase-kebab — they become URLs', () => {
  add('Two_Tank.bas', '10 END\n');
  add('Two_Tank.json', META);
  assert.throws(() => readCatalog(root), /lowercase-kebab-case/);
});

test('a scan or a note dropped into programs/ is rejected', () => {
  // The natural place to put the page photo is next to the listing. It belongs
  // in the pull request instead: programs/ is published verbatim.
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  add('tank-page-47.jpg', 'binary');
  assert.throws(() => readCatalog(root), /Unexpected file\(s\).*tank-page-47\.jpg/);
});

test('an empty listing is rejected', () => {
  add('tank.bas', '   \n');
  add('tank.json', META);
  assert.throws(() => readCatalog(root), /programs\/tank\.bas is empty/);
});

test('the README is documentation, not a stray file', () => {
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  add('README.md', '# Programs');
  assert.equal(readCatalog(root).programs.length, 1);
});
