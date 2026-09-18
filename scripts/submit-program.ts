/**
 * Run by .github/workflows/program-submission.yml when an "Add a program" issue
 * is opened or edited. Builds the program's files into programs/ from the issue
 * body and checks the whole archive with them in place.
 *
 * On success it writes, into $SUBMISSION_OUT, what the workflow needs to commit
 * and open the pull request. On a problem the contributor can fix, it writes a
 * comment for the issue and exits 1. Anything else is a bug and throws.
 *
 * The issue body is untrusted input. It is read from the event payload here,
 * never interpolated into a shell command by the workflow.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ArchiveError, PROGRAMS_DIR, readCatalog } from '../src/basic/program-archive.ts';
import { MetadataError } from '../src/basic/program-catalog.ts';
import {
  SubmissionError,
  buildSubmission,
  commitMessage,
  diagramUrlFrom,
  failureComment,
  parseIssueForm,
  pullRequestBody,
  successComment,
} from '../src/basic/submission.ts';

/** Refuse to read more than this from an attachment, whatever it claims. The
 *  archive's own limit is lower and is enforced by readCatalog below. */
const DOWNLOAD_LIMIT = 10 * 1024 * 1024;

const root = process.cwd();
const out = process.env.SUBMISSION_OUT;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!out || !eventPath) throw new Error('SUBMISSION_OUT and GITHUB_EVENT_PATH must be set');
mkdirSync(out, { recursive: true });

const { issue } = JSON.parse(readFileSync(eventPath, 'utf8'));
const who = { issue: issue.number as number, login: issue.user.login as string, userId: issue.user.id as number };

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new SubmissionError([`Diagram image: the attachment could not be downloaded (HTTP ${response.status}).`]);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > DOWNLOAD_LIMIT) {
    throw new SubmissionError(['Diagram image: the attachment is over 10 MB. Crop it to the figure.']);
  }
  return bytes;
}

try {
  const fields = parseIssueForm(issue.body ?? '');
  const url = diagramUrlFrom(fields);
  const submission = buildSubmission(fields, url ? await download(url) : undefined);

  if (existsSync(join(root, PROGRAMS_DIR, `${submission.id}.bas`))) {
    throw new SubmissionError([
      `Program id: programs/${submission.id}.bas already exists. Choose another id — ` +
        'or, to change the existing program, open an ordinary issue or pull request.',
    ]);
  }

  for (const [name, content] of Object.entries(submission.files)) {
    writeFileSync(join(root, PROGRAMS_DIR, name), content);
  }
  try {
    // The whole archive, with the new files in it: the same check the build runs.
    readCatalog(root);
  } catch (e) {
    if (e instanceof ArchiveError || e instanceof MetadataError) throw new SubmissionError([e.message]);
    throw e;
  }

  writeFileSync(join(out, 'id'), submission.id);
  writeFileSync(join(out, 'pr-title.txt'), `Add program: ${submission.meta.title}`);
  writeFileSync(join(out, 'pr-body.md'), pullRequestBody(submission, who));
  writeFileSync(join(out, 'commit-message.txt'), commitMessage(submission, who));
  // The pull request URL is not known until the workflow opens it.
  writeFileSync(join(out, 'comment-success.md'), successComment('PULL_REQUEST_URL'));
  console.log(`Built ${Object.keys(submission.files).map((f) => `${PROGRAMS_DIR}/${f}`).join(', ')}`);
} catch (e) {
  if (!(e instanceof SubmissionError)) throw e;
  writeFileSync(join(out, 'comment-failure.md'), failureComment(e.problems));
  console.error(e.message);
  process.exitCode = 1;
}
