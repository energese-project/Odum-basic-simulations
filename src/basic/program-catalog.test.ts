import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MetadataError,
  formatAuthor,
  formatAuthors,
  formatCitation,
  parseProgramMeta,
  toBibtex,
} from './program-catalog.ts';

const ORIGINAL = {
  title: 'Charge And Discharge',
  description: 'One tank filled at a constant rate.',
  fidelity: 'original',
};

const VERBATIM = {
  title: 'Mini-model',
  description: 'A storage with an outflow.',
  fidelity: 'verbatim',
  source: {
    type: 'book',
    author: ['Odum, Howard T.'],
    title: 'Systems Ecology: An Introduction',
    publisher: 'Wiley',
    address: 'New York',
    year: 1983,
    pages: '123-125',
  },
};

function parse(value: unknown, id = 'test'): ReturnType<typeof parseProgramMeta> {
  return parseProgramMeta(id, JSON.stringify(value));
}

test('a well-formed original entry parses', () => {
  const meta = parse(ORIGINAL);
  assert.equal(meta.id, 'test');
  assert.equal(meta.fidelity, 'original');
  assert.equal(meta.source, undefined);
  assert.deepEqual(meta.tags, []);
});

test('a well-formed cited entry keeps its source fields', () => {
  const meta = parse(VERBATIM);
  assert.equal(meta.source?.publisher, 'Wiley');
  assert.equal(meta.source?.year, 1983);
  assert.deepEqual(meta.source?.author, ['Odum, Howard T.']);
});

test('fidelity is required and must be one of the four', () => {
  assert.throws(() => parse({ title: 'x', description: 'y' }), MetadataError);
  assert.throws(() => parse({ ...ORIGINAL, fidelity: 'mostly' }), /must be one of/);
});

test('a citation is required unless the program is original', () => {
  // The archive exists so a reader can check a listing against its source. A
  // transcription with nowhere to check is the one thing it must not contain.
  assert.throws(() => parse({ ...ORIGINAL, fidelity: 'verbatim' }), /"source" is required/);
});

test('an original program must not carry a citation', () => {
  assert.throws(
    () => parse({ ...VERBATIM, fidelity: 'original' }),
    /"source" must be omitted/
  );
});

test('a corrected transcription must say what was corrected', () => {
  const corrected = { ...VERBATIM, fidelity: 'corrected' };
  assert.throws(() => parse(corrected), /"notes" is required/);
  assert.equal(parse({ ...corrected, notes: 'Line 140 read PRNT.' }).notes, 'Line 140 read PRNT.');
});

test('the error message names the file and the field', () => {
  assert.throws(
    () => parse({ description: 'y', fidelity: 'original' }, 'two-tank'),
    /programs\/two-tank\.json: "title" is required/
  );
});

test('a year must be a number, because "1983" sorts differently from 1983', () => {
  assert.throws(
    () => parse({ ...VERBATIM, source: { ...VERBATIM.source, year: '1983' } }),
    /"source\.year" must be an integer/
  );
});

test('a DOI must be bare, not a doi.org URL', () => {
  // The display layer prefixes https://doi.org/, so a URL here double-prefixes.
  assert.throws(
    () => parse({ ...VERBATIM, source: { ...VERBATIM.source, doi: 'https://doi.org/10.1234/x' } }),
    /must be a bare DOI/
  );
  assert.equal(
    parse({ ...VERBATIM, source: { ...VERBATIM.source, doi: '10.1234/x' } }).source?.doi,
    '10.1234/x'
  );
});

test('at least one author is required', () => {
  assert.throws(
    () => parse({ ...VERBATIM, source: { ...VERBATIM.source, author: [] } }),
    /"source\.author" is required/
  );
});

test('malformed JSON is reported as such, with the filename', () => {
  assert.throws(() => parseProgramMeta('hello', '{ nope'), /programs\/hello\.json: is not valid JSON/);
});

test('empty strings are treated as absent, not as values', () => {
  assert.throws(() => parse({ ...ORIGINAL, title: '   ' }), /"title" is required/);
  assert.equal(parse({ ...ORIGINAL, notes: '  ' }).notes, undefined);
});

test('authors are rendered from BibLaTeX "Family, Given" form', () => {
  assert.equal(formatAuthor('Odum, Howard T.'), 'H. T. Odum');
  assert.equal(formatAuthor('Odum, Howard Thomas'), 'H. T. Odum');
  assert.equal(formatAuthor('Odum'), 'Odum');
});

test('author lists join with commas and a final "and"', () => {
  assert.equal(formatAuthors(['Odum, Howard T.']), 'H. T. Odum');
  assert.equal(formatAuthors(['Odum, Howard T.', 'Odum, Elisabeth C.']), 'H. T. Odum and E. C. Odum');
  assert.equal(
    formatAuthors(['Odum, Howard T.', 'Odum, Elisabeth C.', 'Brown, Mark T.']),
    'H. T. Odum, E. C. Odum and M. T. Brown'
  );
});

test('a book citation reads as one line', () => {
  assert.equal(
    formatCitation(parse(VERBATIM).source!),
    'H. T. Odum (1983). Systems Ecology: An Introduction. New York: Wiley. pp. 123-125.'
  );
});

test('a journal article names its journal and volume', () => {
  const meta = parse({
    ...VERBATIM,
    source: {
      type: 'article',
      author: ['Odum, Howard T.'],
      title: 'Self-organization, transformity, and information',
      journal: 'Science',
      volume: '242',
      year: 1988,
      pages: '1132-1139',
      doi: '10.1126/science.242.4882.1132',
    },
  });
  assert.equal(
    formatCitation(meta.source!),
    'H. T. Odum (1988). Self-organization, transformity, and information. Science. vol. 242. pp. 1132-1139.'
  );
});

test('a chapter is marked as being in a larger work', () => {
  const meta = parse({
    ...VERBATIM,
    source: {
      type: 'incollection',
      author: ['Odum, Howard T.'],
      title: 'Energy analysis of a mini-model',
      booktitle: 'Ecological Modelling',
      publisher: 'Elsevier',
      year: 1991,
    },
  });
  assert.match(formatCitation(meta.source!), /In: Ecological Modelling/);
});

test('a source exports as a BibLaTeX entry keyed by the program id', () => {
  assert.equal(
    toBibtex('mini-model', parse(VERBATIM).source!),
    [
      '@book{mini-model,',
      '  author = {Odum, Howard T.},',
      '  title = {Systems Ecology: An Introduction},',
      '  publisher = {Wiley},',
      '  address = {New York},',
      '  year = {1983},',
      '  pages = {123--125}',
      '}',
    ].join('\n')
  );
});

test('several authors are joined with "and", as BibTeX requires', () => {
  const meta = parse({
    ...VERBATIM,
    source: { ...VERBATIM.source, author: ['Odum, Howard T.', 'Odum, Elisabeth C.'] },
  });
  assert.match(toBibtex('k', meta.source!), /author = \{Odum, Howard T\. and Odum, Elisabeth C\.\},/);
});

test('LaTeX specials are escaped in text fields but not in a DOI or URL', () => {
  // An unescaped & is a hard error in LaTeX; an escaped one in a DOI is a broken link.
  const meta = parse({
    ...VERBATIM,
    source: {
      ...VERBATIM.source,
      publisher: 'John Wiley & Sons',
      doi: '10.1000/a_b%20c',
      url: 'https://example.org/?a=1&b=2',
    },
  });
  const entry = toBibtex('k', meta.source!);
  assert.match(entry, /publisher = \{John Wiley \\& Sons\},/);
  assert.match(entry, /doi = \{10\.1000\/a_b%20c\},/);
  assert.match(entry, /url = \{https:\/\/example\.org\/\?a=1&b=2\}\n\}$/);
});

// Diagrams --------------------------------------------------------------------

const DIAGRAM = {
  file: 'test.png',
  caption: 'Energy systems diagram of the storage and its outflow.',
  figure: 'Figure 5-3, p. 112',
  rights: {
    basis: 'fair-use',
    statement: 'Reproduced for scholarship, beside the listing it documents.',
  },
};

test('a diagram with its rights recorded parses', () => {
  const meta = parse({ ...VERBATIM, diagram: DIAGRAM });
  assert.deepEqual(meta.diagram, DIAGRAM);
});

test('a program with no diagram has none, rather than an empty one', () => {
  assert.equal(parse(VERBATIM).diagram, undefined);
});

test('the diagram file is named for its program, as a raster image', () => {
  // One diagram per program, found without reading the sidecar. SVG is refused
  // because a raw SVG opened from the published site runs its own scripts.
  for (const file of ['other.png', 'test.svg', 'test.gif', 'figures/test.png']) {
    assert.throws(() => parse({ ...VERBATIM, diagram: { ...DIAGRAM, file } }), /diagram\.file/);
  }
  for (const file of ['test.png', 'test.jpg', 'test.jpeg', 'test.webp']) {
    assert.equal(parse({ ...VERBATIM, diagram: { ...DIAGRAM, file } }).diagram?.file, file);
  }
});

test('a diagram needs a caption, because the caption is its alt text', () => {
  assert.throws(
    () => parse({ ...VERBATIM, diagram: { ...DIAGRAM, caption: '' } }),
    /"diagram\.caption" is required/
  );
});

test('a diagram cannot be added without saying on what basis it is reproduced', () => {
  const { rights: _, ...noRights } = DIAGRAM;
  assert.throws(() => parse({ ...VERBATIM, diagram: noRights }), /"diagram\.rights" is required/);
  assert.throws(
    () => parse({ ...VERBATIM, diagram: { ...DIAGRAM, rights: { basis: 'because' } } }),
    /"diagram\.rights\.basis" must be one of/
  );
  assert.throws(
    () => parse({ ...VERBATIM, diagram: { ...DIAGRAM, rights: { basis: 'permission' } } }),
    /"diagram\.rights\.statement" is required/
  );
});

test('a reproduced figure must come from a cited source; a drawing of our own need not', () => {
  // A scan with no citation is a figure from nowhere — worse than no figure.
  assert.throws(
    () => parse({ ...ORIGINAL, diagram: DIAGRAM }),
    /reproduced diagram needs a "source"/
  );
  const own = { ...DIAGRAM, rights: { basis: 'own-work', statement: 'Drawn for this repository.' } };
  assert.equal(parse({ ...ORIGINAL, diagram: own }).diagram?.rights.basis, 'own-work');
});
