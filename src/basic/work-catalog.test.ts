import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MetadataError } from './program-catalog.ts';
import {
  applyRun,
  checkWorkName,
  parseModelMeta,
  parseRun,
  parseWorkSource,
  workName,
} from './work-catalog.ts';

/**
 * The rules for a published work in programs/<author_title_year>/. Like the
 * archive tests, each is phrased as a mistake someone transcribing an article
 * could actually make.
 */

const ODUM_1989 = {
  type: 'article',
  author: ['Odum, Howard T.'],
  title: 'Simulation models of ecological economics developed with energy language methods',
  journal: 'Simulation',
  volume: '53',
  year: 1989,
  doi: '10.1177/003754978905300205',
};

const FAIR_USE = {
  basis: 'fair-use',
  statement: 'Cropped from the article for scholarship and review, beside the reproduction of its model.',
};

// ------------------------------------------------------------------ the name

test('a work is named for its first author, first title word and year', () => {
  assert.equal(workName(parseWorkSource('odum_simulation_1989', JSON.stringify({ source: ODUM_1989, rights: FAIR_USE })).source), 'odum_simulation_1989');
});

test('a leading article is not the first word, as in a citation key', () => {
  const source = { ...ODUM_1989, title: 'The Energy Basis for Man and Nature', year: 1976 };
  assert.equal(workName(parseWorkSource('x', JSON.stringify({ source, rights: FAIR_USE })).source), 'odum_energy_1976');
});

test('the name is lowercase ASCII whatever the author is called', () => {
  const source = { ...ODUM_1989, author: ['Müller-Brandt, Jürgen'], title: 'Öko: a "model"', year: 2001 };
  assert.equal(workName(parseWorkSource('x', JSON.stringify({ source, rights: FAIR_USE })).source), 'muller-brandt_oko_2001');
});

test('a folder whose name disagrees with its citation is refused, naming the right one', () => {
  const { source } = parseWorkSource('x', JSON.stringify({ source: ODUM_1989, rights: FAIR_USE }));
  checkWorkName('odum_simulation_1989', source);
  // Two works by one author in one year are told apart the way the papers cite
  // them: Odum 1967a, Odum 1967b.
  checkWorkName('odum_simulation_1989b', source);
  assert.throws(() => checkWorkName('odum_simulation_1988', source), /odum_simulation_1988.*odum_simulation_1989/);
  assert.throws(() => checkWorkName('odum_simulations_1989', source), MetadataError);
});

// ------------------------------------------------------------ source.json

test('a work needs its citation and the rights its crops are published under', () => {
  assert.throws(() => parseWorkSource('w', JSON.stringify({ rights: FAIR_USE })), /programs\/w\/source\.json: "source" is required/);
  assert.throws(() => parseWorkSource('w', JSON.stringify({ source: ODUM_1989 })), /programs\/w\/source\.json: "rights" is required/);
  const work = parseWorkSource('w', JSON.stringify({ source: ODUM_1989, rights: FAIR_USE }));
  assert.equal(work.source.doi, '10.1177/003754978905300205');
  assert.equal(work.rights.basis, 'fair-use');
});

test('a work needs a year: it is part of the name', () => {
  const { year: _, ...undated } = ODUM_1989;
  assert.throws(() => parseWorkSource('w', JSON.stringify({ source: undated, rights: FAIR_USE })), /"source\.year" is required/);
});

test('crops from a publication cannot be own work', () => {
  const rights = { basis: 'own-work', statement: 'I cropped it myself.' };
  assert.throws(() => parseWorkSource('w', JSON.stringify({ source: ODUM_1989, rights })), /own-work/);
});

// ---------------------------------------------------------- meta-data.json

const MODEL = {
  title: 'Macroeconomics Minimodel',
  description: 'Assets grow on renewable and nonrenewable sources.',
  fidelity: 'verbatim',
  program: { caption: 'The BASIC listing as printed.', where: 'Table 2, p. 71' },
  diagram: { caption: 'Energy systems diagram of the minimodel.', figure: 'Figure 2, p. 71' },
};

test('a model states its fidelity and what its crops show', () => {
  const meta = parseModelMeta('w/m/meta-data.json', JSON.stringify(MODEL));
  assert.equal(meta.fidelity, 'verbatim');
  assert.equal(meta.program?.where, 'Table 2, p. 71');
  assert.equal(meta.diagram?.figure, 'Figure 2, p. 71');
});

test('fidelity is required, and a model from a publication is never "original"', () => {
  const { fidelity: _, ...none } = MODEL;
  assert.throws(() => parseModelMeta('w/m/meta-data.json', JSON.stringify(none)), /programs\/w\/m\/meta-data\.json: "fidelity" is required/);
  assert.throws(
    () => parseModelMeta('w/m/meta-data.json', JSON.stringify({ ...MODEL, fidelity: 'original' })),
    /"original".*flat/
  );
});

test('a corrected model lists what was corrected', () => {
  assert.throws(() => parseModelMeta('w/m/meta-data.json', JSON.stringify({ ...MODEL, fidelity: 'corrected' })), /"notes" is required/);
});

test('a crop is described in words, for anyone who cannot see it', () => {
  const blind = { ...MODEL, diagram: { figure: 'Figure 2' } };
  assert.throws(() => parseModelMeta('w/m/meta-data.json', JSON.stringify(blind)), /"diagram\.caption" is required/);
});

test('a model does not restate its source: the work states it once', () => {
  const cited = { ...MODEL, source: ODUM_1989 };
  assert.throws(() => parseModelMeta('w/m/meta-data.json', JSON.stringify(cited)), /source\.json/);
});

// -------------------------------------------------------------------- runs

test('a run names the figure it reproduces and the lines it changes', () => {
  const run = parseRun('w/m/runs/fig5.json', JSON.stringify({
    figure: 'Figure 5, p. 73',
    caption: 'Without investment or external trade (IV = 0 and K = 0).',
    changes: { '22': '22 IV = 0', '30': '30 K = 0' },
  }));
  assert.equal(run.figure, 'Figure 5, p. 73');
  assert.deepEqual(run.changes, { '22': '22 IV = 0', '30': '30 K = 0' });
});

test('a run with no changes is the listing as printed', () => {
  const run = parseRun('w/m/runs/fig3a.json', JSON.stringify({ figure: 'Figure 3a', caption: 'Growth with unlimited resources.' }));
  assert.deepEqual(run.changes, {});
});

test('a change keeps its line number, so the diff against the page stays readable', () => {
  const moved = { figure: 'Figure 5', caption: 'x', changes: { '22': '23 IV = 0' } };
  assert.throws(() => parseRun('w/m/runs/fig5.json', JSON.stringify(moved)), /programs\/w\/m\/runs\/fig5\.json: "changes\.22" must start with its line number 22/);
  const unnumbered = { figure: 'Figure 5', caption: 'x', changes: { IV: '22 IV = 0' } };
  assert.throws(() => parseRun('w/m/runs/fig5.json', JSON.stringify(unnumbered)), /line number/);
});

test('a run changes whole lines of the listing and nothing else', () => {
  const listing = '10 REM MODEL\n20 K = 0.1\n30 IV = 5\n40 END\n';
  assert.equal(applyRun(listing, { '30': '30 IV = 0' }), '10 REM MODEL\n20 K = 0.1\n30 IV = 0\n40 END\n');
  assert.equal(applyRun(listing, {}), listing);
  // A scan transcribed on Windows keeps its line endings.
  assert.equal(applyRun('10 A = 1\r\n20 END\r\n', { '10': '10 A = 2' }), '10 A = 2\r\n20 END\r\n');
});

test('a run changing a line the listing does not have is refused', () => {
  assert.throws(() => applyRun('10 A = 1\n20 END\n', { '15': '15 B = 2' }), /line 15/);
});
