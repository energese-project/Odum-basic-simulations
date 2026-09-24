import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArchiveError, publishedFiles, readCatalog } from './program-archive.ts';
import { MetadataError } from './program-catalog.ts';
import { buildTree, programFiles, type TreeNode } from './program-library.ts';

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

// Works: programs/<author_title_year>/<model>/ -------------------------------
//
// A published article or book gets a folder, and each model in it a folder of
// its own: one paper can print several listings, and each listing several runs.

const WORK = 'odum_simulation_1989';

const SOURCE = JSON.stringify({
  source: {
    type: 'article',
    author: ['Odum, Howard T.'],
    title: 'Simulation models of ecological economics developed with energy language methods',
    journal: 'Simulation',
    year: 1989,
  },
  rights: { basis: 'fair-use', statement: 'Cropped for scholarship and review.' },
});

const MODEL_META = JSON.stringify({
  title: 'Macroeconomics Minimodel',
  description: 'Assets grow on renewable and nonrenewable sources.',
  fidelity: 'verbatim',
  program: { caption: 'The listing as printed.', where: 'Table 2, p. 71' },
  diagram: { caption: 'The minimodel in energy systems symbols.', figure: 'Figure 2' },
});

/** Write a file anywhere under programs/, making its folders. */
function put(path: string, content: string | Buffer): void {
  const full = join(root, 'programs', path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

/** A complete work with one model, one run, and every crop. */
function addWork(): void {
  put(`${WORK}/source.json`, SOURCE);
  put(`${WORK}/macroeconomics/model.bas`, '10 K = 0.1\n20 PRINT K\n30 END\n');
  put(`${WORK}/macroeconomics/meta-data.json`, MODEL_META);
  put(`${WORK}/macroeconomics/program.png`, PNG);
  put(`${WORK}/macroeconomics/diagram.png`, PNG);
  put(`${WORK}/macroeconomics/runs/fig3a.json`, JSON.stringify({ figure: 'Figure 3a', caption: 'Unlimited resources.' }));
  put(`${WORK}/macroeconomics/runs/fig3a.png`, PNG);
  put(`${WORK}/macroeconomics/runs/fig3b.json`, JSON.stringify({ figure: 'Figure 3b', caption: 'Limited.', changes: { '10': '10 K = 0' } }));
}

test('each model of a work is catalogued, cited from the work', () => {
  addWork();
  const [entry] = readCatalog(root).programs;
  assert.equal(entry.id, `${WORK}/macroeconomics`);
  assert.equal(entry.file, `${WORK}/macroeconomics/model.bas`);
  assert.equal(entry.sidecar, `${WORK}/macroeconomics/meta-data.json`);
  assert.equal(entry.listing, '10 K = 0.1\n20 PRINT K\n30 END\n');
  assert.equal(entry.fidelity, 'verbatim');
  assert.equal(entry.source?.journal, 'Simulation');
  assert.deepEqual(entry.work, { id: WORK, file: `${WORK}/source.json` });
});

test('the crops of a model carry the rights the work states for them', () => {
  addWork();
  const [entry] = readCatalog(root).programs;
  assert.equal(entry.diagram?.file, `${WORK}/macroeconomics/diagram.png`);
  assert.equal(entry.diagram?.rights.basis, 'fair-use');
  assert.deepEqual(entry.programImage, {
    file: `${WORK}/macroeconomics/program.png`,
    caption: 'The listing as printed.',
    where: 'Table 2, p. 71',
  });
});

test('the runs of a model are catalogued in order, each with its published plot', () => {
  addWork();
  const [entry] = readCatalog(root).programs;
  assert.deepEqual(
    entry.runs.map((r) => [r.id, r.plot, r.changes]),
    [
      ['fig3a', `${WORK}/macroeconomics/runs/fig3a.png`, {}],
      ['fig3b', null, { '10': '10 K = 0' }],
    ]
  );
});

test('works and single programs share one catalog, sorted by id', () => {
  addWork();
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  const catalog = readCatalog(root);
  assert.deepEqual(catalog.programs.map((p) => p.id), [`${WORK}/macroeconomics`, 'tank']);
  const tank = catalog.programs[1];
  assert.equal(tank.sidecar, 'tank.json');
  assert.equal(tank.work, null);
  assert.equal(tank.programImage, null);
  assert.deepEqual(tank.runs, []);
});

test('every file the catalog refers to is published, and nothing else', () => {
  addWork();
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  const m = `${WORK}/macroeconomics`;
  assert.deepEqual(publishedFiles(readCatalog(root)), [
    `${m}/diagram.png`,
    `${m}/meta-data.json`,
    `${m}/model.bas`,
    `${m}/program.png`,
    `${m}/runs/fig3a.json`,
    `${m}/runs/fig3a.png`,
    `${m}/runs/fig3b.json`,
    `${WORK}/source.json`,
    'tank.bas',
    'tank.json',
  ]);
});

test('the explorer shows every published file of a program, and no others', () => {
  // The explorer is how a reader gets from a listing to its metadata, its
  // source and its figures. A file published but not listed is unreachable in
  // the app; one listed but not published is a 404 on click.
  addWork();
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  const catalog = readCatalog(root);
  const listed = catalog.programs.flatMap((p) => programFiles(p).map((f) => f.path));
  assert.deepEqual([...new Set(listed)].sort(), publishedFiles(catalog));
});

test('a model lists its listing first, and names each file from its own folder', () => {
  addWork();
  const m = `${WORK}/macroeconomics`;
  const [entry] = readCatalog(root).programs;
  assert.deepEqual(
    programFiles(entry).map((f) => [f.name, f.path, f.kind]),
    [
      ['model.bas', `${m}/model.bas`, 'basic'],
      ['meta-data.json', `${m}/meta-data.json`, 'json'],
      ['source.json', `${WORK}/source.json`, 'json'],
      ['diagram.png', `${m}/diagram.png`, 'image'],
      ['program.png', `${m}/program.png`, 'image'],
      ['runs/fig3a.json', `${m}/runs/fig3a.json`, 'json'],
      ['runs/fig3a.png', `${m}/runs/fig3a.png`, 'image'],
      ['runs/fig3b.json', `${m}/runs/fig3b.json`, 'json'],
    ]
  );
});

/** A tree as the explorer draws it: one line per row, folders marked with a slash. */
function outline(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.name}${n.kind === 'file' ? '' : '/'}`,
    ...outline(n.children, depth + 1),
  ]);
}

test('the explorer tree is the archive laid out as folders, the way an editor shows it', () => {
  // A work is its folder, holding its source and a folder per model; a model's
  // runs are a folder of their own. Folders first, then files by name, as in
  // VS Code. A single program is a folder of its own files, named by its title.
  addWork();
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  assert.deepEqual(outline(buildTree(readCatalog(root).programs, '')), [
    `${WORK}/`,
    '  Macroeconomics Minimodel/',
    '    runs/',
    '      fig3a.json',
    '      fig3a.png',
    '      fig3b.json',
    '    diagram.png',
    '    meta-data.json',
    '    model.bas',
    '    program.png',
    '  source.json',
    'A Program/',
    '  tank.bas',
    '  tank.json',
  ]);
});

test('every file in the tree is a published file, each exactly once', () => {
  addWork();
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  const catalog = readCatalog(root);
  const paths = (nodes: TreeNode[]): string[] =>
    nodes.flatMap((n) => (n.file ? [n.file.path] : paths(n.children)));
  assert.deepEqual(paths(buildTree(catalog.programs, '')).sort(), publishedFiles(catalog));
});

test('the filter keeps a program with its work, and drops a work with nothing left in it', () => {
  addWork();
  add('tank.bas', '10 END\n');
  add('tank.json', META);
  const programs = readCatalog(root).programs;
  assert.deepEqual(
    buildTree(programs, 'macroeconomics').map((n) => n.name),
    [WORK]
  );
  assert.deepEqual(buildTree(programs, 'a program').map((n) => n.name), ['A Program']);
});

test('a work folder named differently from its citation is refused', () => {
  addWork();
  // Renaming is how a typo in either the folder or the year gets caught.
  put('odum_simulation_1988/source.json', SOURCE);
  put('odum_simulation_1988/m/model.bas', '10 END\n');
  put('odum_simulation_1988/m/meta-data.json', MODEL_META);
  assert.throws(() => readCatalog(root), /odum_simulation_1988.*odum_simulation_1989/);
});

test('a folder in programs/ must be named like a work', () => {
  put('Odum Simulation 1989/source.json', SOURCE);
  assert.throws(() => readCatalog(root), /Odum Simulation 1989.*author_title_year/);
});

test('a work without its source.json is refused', () => {
  put(`${WORK}/m/model.bas`, '10 END\n');
  put(`${WORK}/m/meta-data.json`, MODEL_META);
  assert.throws(() => readCatalog(root), /programs\/odum_simulation_1989\/source\.json/);
});

test('a work with no model folder is refused', () => {
  put(`${WORK}/source.json`, SOURCE);
  assert.throws(() => readCatalog(root), /programs\/odum_simulation_1989 has no model/);
});

test('a model needs both its listing and its metadata', () => {
  put(`${WORK}/source.json`, SOURCE);
  put(`${WORK}/m/model.bas`, '10 END\n');
  assert.throws(() => readCatalog(root), /programs\/odum_simulation_1989\/m\/meta-data\.json/);
  rmSync(join(root, 'programs', WORK, 'm', 'model.bas'));
  put(`${WORK}/m/meta-data.json`, MODEL_META);
  assert.throws(() => readCatalog(root), /programs\/odum_simulation_1989\/m\/model\.bas/);
});

test('model folders are lowercase-kebab, like program ids', () => {
  addWork();
  put(`${WORK}/Macro_Model/model.bas`, '10 END\n');
  assert.throws(() => readCatalog(root), /lowercase-kebab.*Macro_Model/);
});

test('a crop the metadata does not describe is refused — it has no caption', () => {
  addWork();
  put(`${WORK}/macroeconomics/meta-data.json`, JSON.stringify({ ...JSON.parse(MODEL_META), program: undefined }));
  assert.throws(() => readCatalog(root), /program\.png.*"program"/);
});

test('a crop the metadata describes but that was never added is refused', () => {
  addWork();
  rmSync(join(root, 'programs', WORK, 'macroeconomics', 'diagram.png'));
  assert.throws(() => readCatalog(root), /meta-data\.json describes a "diagram" but there is no diagram image/);
});

test('two images for one crop are refused — which one is it?', () => {
  addWork();
  put(`${WORK}/macroeconomics/diagram.jpg`, JPEG);
  assert.throws(() => readCatalog(root), /diagram\.jpg.*diagram\.png|diagram\.png.*diagram\.jpg/);
});

test('a plot with no run to say what it shows is refused', () => {
  addWork();
  put(`${WORK}/macroeconomics/runs/fig9.png`, PNG);
  assert.throws(() => readCatalog(root), /runs\/fig9\.png/);
});

test('a run changing a line the listing does not have is refused, naming the run', () => {
  addWork();
  put(`${WORK}/macroeconomics/runs/fig3b.json`, JSON.stringify({ figure: 'Figure 3b', caption: 'x', changes: { '15': '15 K = 0' } }));
  assert.throws(() => readCatalog(root), /runs\/fig3b\.json.*line 15/);
});

test('a note or a scan dropped into a work is refused, as it is at the top', () => {
  addWork();
  put(`${WORK}/macroeconomics/notes.txt`, 'hard to read');
  assert.throws(() => readCatalog(root), /Unexpected file\(s\).*notes\.txt/);
});

test('the article itself is never published, wherever it is put', () => {
  // The PDF is the natural thing to leave beside the files cut from it. It is
  // someone else's copyright, and programs/ is published as it stands.
  addWork();
  put(`${WORK}/HTOdum_1989_Simulation.pdf`, '%PDF-1.4');
  assert.throws(() => readCatalog(root), /HTOdum_1989_Simulation\.pdf.*never published/);
  rmSync(join(root, 'programs', WORK, 'HTOdum_1989_Simulation.pdf'));
  add('paper.pdf', '%PDF-1.4');
  assert.throws(() => readCatalog(root), /paper\.pdf.*never published/);
});
