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
  add('tank-notes.txt', 'what I could not read');
  assert.throws(() => readCatalog(root), /Unexpected file\(s\).*tank-notes\.txt/);
  rmSync(join(root, 'programs', 'tank-notes.txt'));
  // An image is allowed only as a declared diagram, so a stray photo is refused
  // for having no recorded rights rather than for being an image.
  assert.throws(() => readCatalog(root), /not declared by any sidecar.*tank-page-47\.jpg/);
});

// Diagrams --------------------------------------------------------------------

/** The first bytes of each format — enough for the signature check. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

function withDiagram(file: string): string {
  return JSON.stringify({
    title: 'A Program',
    description: 'Does a thing.',
    fidelity: 'original',
    diagram: {
      file,
      caption: 'The storage and its drain.',
      rights: { basis: 'own-work', statement: 'Drawn for this repository.' },
    },
  });
}

function addBinary(name: string, content: Buffer): void {
  writeFileSync(join(root, 'programs', name), content);
}

test('a diagram named for its program and declared in its sidecar is catalogued', () => {
  add('tank.bas', '10 END\n');
  add('tank.json', withDiagram('tank.png'));
  addBinary('tank.png', PNG);

  const [entry] = readCatalog(root).programs;
  assert.equal(entry.diagram?.file, 'tank.png');
  assert.equal(entry.diagram?.caption, 'The storage and its drain.');
});

test('a program with no diagram carries null, not an absent key', () => {
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  assert.equal(readCatalog(root).programs[0].diagram, null);
});

test('a sidecar naming a diagram that was never added fails, naming the file', () => {
  add('tank.bas', '10 END\n');
  add('tank.json', withDiagram('tank.png'));
  assert.throws(() => readCatalog(root), /programs\/tank\.png.*does not exist/);
});

test('an image the sidecar does not declare is rejected — its rights are unrecorded', () => {
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  addBinary('tank.png', PNG);
  assert.throws(() => readCatalog(root), /not declared by any sidecar: programs\/tank\.png/);
});

test('an image whose content is not what its extension says is rejected', () => {
  // A phone photo renamed to .png renders as a broken image on the site.
  add('tank.bas', '10 END\n');
  add('tank.json', withDiagram('tank.png'));
  addBinary('tank.png', JPEG);
  assert.throws(() => readCatalog(root), /programs\/tank\.png is not a PNG/);
});

test('an oversized diagram is rejected, with the limit in the message', () => {
  add('tank.bas', '10 END\n');
  add('tank.json', withDiagram('tank.jpg'));
  addBinary('tank.jpg', Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]));
  assert.throws(() => readCatalog(root), /programs\/tank\.jpg is .* over the 2 MB limit/);
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
