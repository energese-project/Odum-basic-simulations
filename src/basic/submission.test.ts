import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FORM_LABELS,
  SubmissionError,
  buildSubmission,
  diagramUrlFrom,
  parseIssueForm,
  pullRequestBody,
  commitMessage,
  failureComment,
  IGNORED_LABELS,
} from './submission.ts';

/**
 * A program submitted through the issue form arrives as the markdown GitHub
 * renders from it. These tests are written against that markdown, phrased as
 * the things a contributor filling in the form could get wrong.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

/** An issue body as GitHub renders it, from label → value; unset fields as GitHub shows them. */
function issueBody(values: Partial<Record<keyof typeof FORM_LABELS, string>>): string {
  return (Object.keys(FORM_LABELS) as (keyof typeof FORM_LABELS)[])
    .map((key) => `### ${FORM_LABELS[key]}\n\n${values[key] ?? '_No response_'}`)
    .join('\n\n');
}

const ORIGINAL = {
  id: 'tank',
  title: 'A Tank',
  description: 'One storage, filled and drained.',
  fidelity: 'original',
  listing: '```basic\n10 PRINT "HELLO"\n20 END\n```',
};

const VERBATIM = {
  ...ORIGINAL,
  fidelity: 'verbatim',
  sourceType: 'book',
  authors: 'Odum, Howard T.\nOdum, Elisabeth C.',
  sourceTitle: 'Computer Minimodels and Simulation Exercises',
  publisher: 'Center for Wetlands, University of Florida',
  address: 'Gainesville',
  year: '1989',
  pages: '12-13',
};

const build = (values: Parameters<typeof issueBody>[0], image?: Buffer) =>
  buildSubmission(parseIssueForm(issueBody(values)), image);

// The form ----------------------------------------------------------------------

test('every label the parser reads is a field in the issue form', () => {
  // The two are matched by label text. Rename one without the other and every
  // submission silently loses that field, so the template is checked here.
  const template = readFileSync('.github/ISSUE_TEMPLATE/add-program.yml', 'utf8');
  const labels = [...template.matchAll(/^\s+label:\s*(.+)$/gm)].map((m) =>
    m[1].trim().replace(/^["']|["']$/g, '')
  );
  for (const label of Object.values(FORM_LABELS)) {
    assert.ok(labels.includes(label), `the form has a field labelled "${label}"`);
  }
});

test('fields are read by heading, and GitHub\'s "_No response_" is read as empty', () => {
  const fields = parseIssueForm(issueBody({ id: 'tank', title: 'A Tank' }));
  assert.equal(fields.id, 'tank');
  assert.equal(fields.title, 'A Tank');
  assert.equal(fields.notes, '');
});

test('the form\'s sections that are not program fields do not leak into the one before', () => {
  // The page photo and the checkbox are rendered after the rights statement;
  // read naively they would be published as part of it.
  const body =
    issueBody({ rightsStatement: 'Reproduced for scholarship.' }) +
    '\n\n### Photo of the source page\n\n![page](https://github.com/user-attachments/assets/p)' +
    '\n\n### Before submitting\n\n- [X] I have checked the listing against the source.';
  const fields = parseIssueForm(body);
  assert.equal(fields.rightsStatement, 'Reproduced for scholarship.');
});

test('every heading in the form is known to the parser, read or deliberately ignored', () => {
  const template = readFileSync('.github/ISSUE_TEMPLATE/add-program.yml', 'utf8');
  const labels = [...template.matchAll(/^      label:\s*(.+)$/gm)].map((m) => m[1].trim());
  const known = [...Object.values(FORM_LABELS), ...IGNORED_LABELS] as string[];
  for (const label of labels) {
    assert.ok(known.includes(label), `"${label}" is either read or listed in IGNORED_LABELS`);
  }
});

test('Windows line endings from a pasted listing do not leak into the fields', () => {
  const fields = parseIssueForm(issueBody(ORIGINAL).replace(/\n/g, '\r\n'));
  assert.equal(fields.title, 'A Tank');
  assert.ok(!fields.listing.includes('\r'));
});

// The listing ---------------------------------------------------------------------

test('the listing loses its code fence and gains a final newline', () => {
  const { files } = build(ORIGINAL);
  assert.equal(files['tank.bas'], '10 PRINT "HELLO"\n20 END\n');
});

test('a listing pasted without a fence is kept exactly', () => {
  const { files } = build({ ...ORIGINAL, listing: '10 PRINT 1\n20 END' });
  assert.equal(files['tank.bas'], '10 PRINT 1\n20 END\n');
});

// The metadata --------------------------------------------------------------------

test('an original program becomes a sidecar with no source', () => {
  const { id, files } = build(ORIGINAL);
  assert.equal(id, 'tank');
  assert.deepEqual(JSON.parse(files['tank.json'].toString()), {
    title: 'A Tank',
    description: 'One storage, filled and drained.',
    fidelity: 'original',
  });
});

test('a cited program carries its source in BibLaTeX form', () => {
  const sidecar = JSON.parse(build(VERBATIM).files['tank.json'].toString());
  assert.deepEqual(sidecar.source, {
    type: 'book',
    author: ['Odum, Howard T.', 'Odum, Elisabeth C.'],
    title: 'Computer Minimodels and Simulation Exercises',
    publisher: 'Center for Wetlands, University of Florida',
    address: 'Gainesville',
    year: 1989,
    pages: '12-13',
  });
});

test('the publisher field is an institution for a report or thesis', () => {
  const sidecar = JSON.parse(
    build({ ...VERBATIM, sourceType: 'report' }).files['tank.json'].toString()
  );
  assert.equal(sidecar.source.institution, 'Center for Wetlands, University of Florida');
  assert.equal(sidecar.source.publisher, undefined);
});

test('tags are split on commas and trimmed', () => {
  const sidecar = JSON.parse(
    build({ ...ORIGINAL, tags: 'mini-model,  storage ,, lag' }).files['tank.json'].toString()
  );
  assert.deepEqual(sidecar.tags, ['mini-model', 'storage', 'lag']);
});

// What gets refused, and how ------------------------------------------------------

function problems(values: Parameters<typeof issueBody>[0], image?: Buffer): string[] {
  try {
    build(values, image);
  } catch (e) {
    assert.ok(e instanceof SubmissionError, `a SubmissionError, not ${e}`);
    return e.problems;
  }
  assert.fail('the submission was accepted');
}

test('every form mistake is reported at once, not one per round trip', () => {
  const found = problems({ ...ORIGINAL, id: 'Two Tank', year: 'nineteen-eighty', title: '' });
  assert.equal(found.length, 3);
  assert.match(found.join('\n'), /Program id/);
  assert.match(found.join('\n'), /Year/);
  assert.match(found.join('\n'), /Title/);
});

test('the build\'s own metadata rules apply, in the words of the form', () => {
  // A verbatim transcription with nothing cited: the same rule the build
  // enforces, reported against the form rather than a JSON file.
  const [problem] = problems({ ...ORIGINAL, fidelity: 'verbatim' });
  assert.match(problem, /"source" is required unless fidelity is "original"/);
  assert.doesNotMatch(problem, /programs\/tank\.json/);
});

test('a corrected listing must say what was corrected', () => {
  const [problem] = problems({ ...VERBATIM, fidelity: 'corrected' });
  assert.match(problem, /"notes" is required/);
});

test('an empty listing is refused', () => {
  const [problem] = problems({ ...ORIGINAL, listing: '```basic\n\n```' });
  assert.match(problem, /Listing/);
});

// The diagram ---------------------------------------------------------------------

const DIAGRAM = {
  diagram: '![two-tank](https://github.com/user-attachments/assets/0f3e-4a1b)',
  diagramCaption: 'Two storages in series.',
  diagramFigure: 'Figure 5-3, p. 112',
  rightsBasis: 'fair-use',
  rightsStatement: 'Reproduced for scholarship, beside the listing.',
};

test('the diagram URL is taken from the markdown GitHub writes for a dropped image', () => {
  const md = parseIssueForm(issueBody({ diagram: DIAGRAM.diagram }));
  assert.equal(diagramUrlFrom(md), 'https://github.com/user-attachments/assets/0f3e-4a1b');

  const html = parseIssueForm(
    issueBody({ diagram: '<img width="600" alt="x" src="https://github.com/user-attachments/assets/abc" />' })
  );
  assert.equal(diagramUrlFrom(html), 'https://github.com/user-attachments/assets/abc');

  assert.equal(diagramUrlFrom(parseIssueForm(issueBody({}))), null);
});

test('a diagram is only fetched from GitHub\'s own attachment hosts', () => {
  // The workflow downloads whatever this returns; it must not be steerable.
  const fields = parseIssueForm(issueBody({ diagram: '![x](https://example.com/figure.png)' }));
  assert.throws(() => diagramUrlFrom(fields), /drag the image into the form/);
});

test('the diagram is named for the program, with the extension its bytes say', () => {
  const { files } = build({ ...VERBATIM, ...DIAGRAM }, JPEG);
  assert.ok(files['tank.jpg']);
  const sidecar = JSON.parse(files['tank.json'].toString());
  assert.deepEqual(sidecar.diagram, {
    file: 'tank.jpg',
    caption: 'Two storages in series.',
    figure: 'Figure 5-3, p. 112',
    rights: { basis: 'fair-use', statement: 'Reproduced for scholarship, beside the listing.' },
  });
});

test('an attachment that is not a PNG, JPEG or WebP is refused', () => {
  const [problem] = problems({ ...VERBATIM, ...DIAGRAM }, Buffer.from('%PDF-1.7'));
  assert.match(problem, /PNG, JPEG or WebP/);
});

test('a diagram without its rights is refused by the build\'s rule', () => {
  const [problem] = problems({ ...VERBATIM, ...DIAGRAM, rightsBasis: '', rightsStatement: '' }, PNG);
  assert.match(problem, /"diagram\.rights" is required|"diagram\.rights\.basis" is required/);
});

test('diagram details with no image attached are refused rather than dropped', () => {
  const { diagram: _, ...details } = DIAGRAM;
  const [problem] = problems({ ...VERBATIM, ...details });
  assert.match(problem, /no image/);
});

// What the bot writes ---------------------------------------------------------------

test('the pull request closes the issue and credits who filled it in', () => {
  const submission = build(VERBATIM);
  const body = pullRequestBody(submission, { issue: 42, login: 'odum-reader' });
  assert.match(body, /Closes #42/);
  assert.match(body, /@odum-reader/);
  assert.match(body, /verbatim/);
});

test('the commit is co-authored by the submitter, so the history names them', () => {
  const message = commitMessage(build(ORIGINAL), { issue: 42, login: 'odum-reader', userId: 7 });
  assert.match(message, /^feat\(programs\): add tank/);
  assert.match(message, /Co-authored-by: odum-reader <7\+odum-reader@users\.noreply\.github\.com>$/);
});

test('a refusal is one comment listing every problem, marked so the bot can update it', () => {
  const comment = failureComment(['Title is required.', 'Year must be a four-digit year.']);
  assert.match(comment, /^<!-- program-submission -->/);
  assert.match(comment, /- Title is required\./);
  assert.match(comment, /- Year must be a four-digit year\./);
  assert.match(comment, /edit this issue/i);
});
