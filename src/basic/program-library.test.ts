import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPrograms, sidebarOpen } from './program-library.ts';

const LIBRARY = [
  {
    id: 'charge-discharge',
    title: 'Charge And Discharge',
    description: 'One tank filled at a constant rate and drained in proportion to storage.',
    fidelity: 'original' as const,
    tags: ['mini-model', 'storage', 'steady-state'],
  },
  {
    id: 'logistic-growth',
    title: 'Logistic Growth',
    description: 'Autocatalytic growth against a limiting source.',
    fidelity: 'verbatim' as const,
    tags: ['mini-model', 'autocatalytic', 'limiting-source'],
  },
  {
    id: 'hello',
    title: 'Hello',
    description: 'The smallest thing that proves the interpreter runs at all.',
    fidelity: 'original' as const,
    tags: ['smoke-test'],
  },
];

const ids = (query: string): string[] => filterPrograms(LIBRARY, query).map((p) => p.id);

test('an empty or blank query keeps the whole library, in order', () => {
  assert.deepEqual(ids(''), ['charge-discharge', 'logistic-growth', 'hello']);
  assert.deepEqual(ids('   '), ['charge-discharge', 'logistic-growth', 'hello']);
});

test('a query matches the title regardless of case', () => {
  assert.deepEqual(ids('logistic'), ['logistic-growth']);
  assert.deepEqual(ids('HELLO'), ['hello']);
});

test('a query matches the description and the tags, not just the title', () => {
  assert.deepEqual(ids('drained'), ['charge-discharge']);
  assert.deepEqual(ids('mini-model'), ['charge-discharge', 'logistic-growth']);
});

test('a query matches the fidelity, so a reader can ask for only the transcriptions', () => {
  assert.deepEqual(ids('verbatim'), ['logistic-growth']);
});

test('every word must match, so adding words narrows rather than widens', () => {
  assert.deepEqual(ids('mini-model storage'), ['charge-discharge']);
  assert.deepEqual(ids('mini-model smoke-test'), []);
});

test('the sidebar opens by default on a wide screen and not on a narrow one', () => {
  assert.equal(sidebarOpen(null, true), true);
  assert.equal(sidebarOpen(null, false), false);
});

test('a stored choice decides on a wide screen, in both directions', () => {
  assert.equal(sidebarOpen('closed', true), false);
  assert.equal(sidebarOpen('open', true), true);
});

test('a narrow screen always starts closed, because there the sidebar covers the code', () => {
  // Opening it on a phone is a momentary look, not a preference to restore.
  assert.equal(sidebarOpen('open', false), false);
});

test('a stored value that is not a choice is ignored rather than trusted', () => {
  assert.equal(sidebarOpen('banana', true), true);
  assert.equal(sidebarOpen('', true), true);
});
