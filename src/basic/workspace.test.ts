import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Workspace,
  type FileStore,
} from './workspace.ts';

/**
 * "My programs": the reader's own programs, kept in the browser. The same
 * layout as programs/ in the repository — <id>.bas, <id>.json, <id>.png — so
 * what they download or submit is exactly what the archive would hold.
 *
 * These run against an in-memory store; the app gives the same class OPFS.
 */

class MemoryStore implements FileStore {
  files = new Map<string, Uint8Array>();
  async list() {
    return [...this.files.keys()];
  }
  async read(name: string) {
    return this.files.get(name) ?? null;
  }
  async write(name: string, data: Uint8Array | string) {
    this.files.set(name, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }
  async remove(name: string) {
    this.files.delete(name);
  }
  text(name: string): string {
    return new TextDecoder().decode(this.files.get(name));
  }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

const ARCHIVE_PROGRAM = {
  id: 'two-tank',
  title: 'Two Tanks In Series',
  description: 'A storage draining into a second storage.',
  fidelity: 'verbatim' as const,
  source: {
    type: 'book' as const,
    author: ['Odum, Howard T.'],
    title: 'Systems Ecology',
    year: 1983,
  },
  tags: ['storage'],
  file: 'two-tank.bas',
  listing: '10 PRINT "T"\n20 END\n',
};

function setup(archiveIds: string[] = ['two-tank', 'charge-discharge']) {
  const store = new MemoryStore();
  return { store, workspace: new Workspace(store, archiveIds) };
}

test('an empty workspace has no programs', async () => {
  const { workspace } = setup();
  assert.deepEqual(await workspace.list(), []);
});

test('a new program is a runnable listing and a sidecar, under an id nobody has', async () => {
  const { store, workspace } = setup();
  const first = await workspace.create();
  const second = await workspace.create();

  assert.equal(first, 'untitled');
  assert.equal(second, 'untitled-2');
  assert.match(store.text('untitled.bas'), /^10 REM/);
  assert.match(store.text('untitled.bas'), /END\n$/);
  assert.deepEqual(JSON.parse(store.text('untitled.json')), { title: 'Untitled' });
  assert.deepEqual(
    (await workspace.list()).map((p) => p.id),
    ['untitled', 'untitled-2']
  );
});

test('the programs are listed with what each one has', async () => {
  const { workspace } = setup();
  const id = await workspace.create();
  await workspace.saveImage(id, PNG);

  const [program] = await workspace.list();
  assert.deepEqual(program.files, ['untitled.bas', 'untitled.json', 'untitled.png']);
  assert.equal(program.title, 'Untitled');
});

test('a program reads back as its listing, its form fields and its diagram', async () => {
  const { workspace } = setup();
  const id = await workspace.create();
  const program = await workspace.open(id);

  assert.equal(program.id, 'untitled');
  assert.equal(program.fields.id, 'untitled');
  assert.equal(program.fields.title, 'Untitled');
  assert.match(program.listing, /^10 REM/);
  assert.equal(program.image, null);
});

test('edits to the listing and the fields are saved as the files the archive would hold', async () => {
  const { store, workspace } = setup();
  const id = await workspace.create();
  const program = await workspace.open(id);

  await workspace.saveListing(id, '10 PRINT 1\n20 END\n');
  await workspace.saveFields(id, { ...program.fields, title: 'Mini Tank', fidelity: 'original', year: '1983' });

  assert.equal(store.text('untitled.bas'), '10 PRINT 1\n20 END\n');
  const sidecar = JSON.parse(store.text('untitled.json'));
  assert.equal(sidecar.title, 'Mini Tank');
  assert.equal(sidecar.fidelity, 'original');
  assert.equal(sidecar.source.year, 1983);
});

test('a diagram is stored under the extension its bytes say, replacing any earlier one', async () => {
  const { store, workspace } = setup();
  const id = await workspace.create();

  await workspace.saveImage(id, PNG);
  await workspace.saveImage(id, JPEG);

  assert.ok(store.files.has('untitled.jpg'));
  assert.ok(!store.files.has('untitled.png'), 'the old diagram is gone, not left beside the new one');
  assert.equal((await workspace.open(id)).imageFile, 'untitled.jpg');
});

test('an attachment that is not a PNG, JPEG or WebP is refused rather than stored', async () => {
  const { workspace } = setup();
  const id = await workspace.create();
  await assert.rejects(workspace.saveImage(id, new TextEncoder().encode('%PDF-1.7')), /PNG, JPEG or WebP/);
});

test('renaming a program moves every file and keeps the sidecar pointing at its diagram', async () => {
  const { store, workspace } = setup();
  const id = await workspace.create();
  await workspace.saveImage(id, PNG);
  const program = await workspace.open(id);
  await workspace.saveFields(id, { ...program.fields, diagramCaption: 'A tank.' });

  await workspace.rename(id, 'mini-tank');

  assert.deepEqual([...store.files.keys()].sort(), ['mini-tank.bas', 'mini-tank.json', 'mini-tank.png']);
  assert.equal(JSON.parse(store.text('mini-tank.json')).diagram.file, 'mini-tank.png');
});

test('a rename to an id that is not lowercase-kebab, or already taken, is refused', async () => {
  const { workspace } = setup();
  const id = await workspace.create();
  await workspace.create();
  await assert.rejects(workspace.rename(id, 'Mini Tank'), /lowercase/);
  await assert.rejects(workspace.rename(id, 'untitled-2'), /already/);
  await assert.rejects(workspace.rename(id, 'two-tank'), /archive/);
});

test('a program can be deleted, all of it', async () => {
  const { store, workspace } = setup();
  const id = await workspace.create();
  await workspace.saveImage(id, PNG);
  await workspace.remove(id);
  assert.equal(store.files.size, 0);
});

test('a copy of an archive program keeps its listing and citation but not its fidelity', async () => {
  // Once edited, a verbatim listing is no longer verbatim. The copy says where
  // it came from, and the reader has to choose the fidelity again.
  const { store, workspace } = setup();
  const id = await workspace.copyFromArchive(ARCHIVE_PROGRAM);

  assert.equal(id, 'two-tank-copy');
  assert.equal(store.text('two-tank-copy.bas'), ARCHIVE_PROGRAM.listing);
  const sidecar = JSON.parse(store.text('two-tank-copy.json'));
  assert.equal(sidecar.fidelity, undefined);
  assert.equal(sidecar.source.title, 'Systems Ecology');
  assert.match(sidecar.notes, /Copied from the archive's two-tank, which is verbatim/);
});

test('a model copied from a work gets a file name, not its path in the archive', async () => {
  // A work's model is programs/<work>/<model>/: its id has a slash in it, which
  // a file in the reader's own store cannot.
  const { store, workspace } = setup();
  const id = await workspace.copyFromArchive({ ...ARCHIVE_PROGRAM, id: 'odum_simulation_1989/state-development' });
  assert.equal(id, 'odum-simulation-1989-state-development-copy');
  assert.equal(store.text(`${id}.bas`), ARCHIVE_PROGRAM.listing);
  assert.match(
    JSON.parse(store.text(`${id}.json`)).notes,
    /Copied from the archive's odum_simulation_1989\/state-development/
  );
});

test('a copied diagram comes along, under the new id', async () => {
  const { store, workspace } = setup();
  const id = await workspace.copyFromArchive(
    {
      ...ARCHIVE_PROGRAM,
      diagram: {
        file: 'two-tank.png',
        caption: 'Two tanks.',
        rights: { basis: 'own-work', statement: 'Drawn here.' },
      },
    },
    PNG
  );
  assert.ok(store.files.has(`${id}.png`));
  assert.equal(JSON.parse(store.text(`${id}.json`)).diagram.file, `${id}.png`);
});

test('checking a program reports what would stop it being submitted', async () => {
  const { workspace } = setup();
  const id = await workspace.create();
  const problems = await workspace.check(id);
  assert.ok(problems.some((p) => /Description is required/.test(p)));
  assert.ok(problems.some((p) => /Fidelity is required/.test(p)));
});

test('a new program never takes an id the archive already has', async () => {
  const { workspace } = setup(['untitled']);
  assert.equal(await workspace.create(), 'untitled-2');
});

test('a program whose id has since appeared in the archive cannot be submitted', async () => {
  // Someone else's program with the same id was merged after this one was started.
  const { store, workspace } = setup(['mini-tank']);
  await store.write('mini-tank.bas', '10 END\n');
  await store.write(
    'mini-tank.json',
    JSON.stringify({ title: 'Mini Tank', description: 'One storage.', fidelity: 'original' })
  );
  const problems = await workspace.check('mini-tank');
  assert.ok(problems.some((p) => /already in the archive/.test(p)));
});

test('a complete program passes the check the submission bot will run', async () => {
  const { workspace } = setup();
  const id = await workspace.create();
  const program = await workspace.open(id);
  await workspace.saveFields(id, {
    ...program.fields,
    title: 'Mini Tank',
    description: 'One storage.',
    fidelity: 'original',
  });
  assert.deepEqual(await workspace.check(id), []);
});

test('files that are not a program are ignored rather than listed', async () => {
  const { store, workspace } = setup();
  await store.write('.DS_Store', 'x');
  await store.write('notes.txt', 'x');
  assert.deepEqual(await workspace.list(), []);
});

test('a program file can be read back for download, and nothing else can', async () => {
  const { store, workspace } = setup();
  const id = await workspace.create();
  await store.write('.secret', 'x');
  assert.match(new TextDecoder().decode((await workspace.readFile(`${id}.bas`))!), /^10 REM/);
  assert.equal(await workspace.readFile('.secret'), null);
});
