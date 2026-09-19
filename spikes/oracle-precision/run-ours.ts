/**
 * Runs `table3-trace.bas` in our interpreter and writes `runs/<run>.txt`: one row
 * per step, `T D IV N A M`, each at the full precision the interpreter held it.
 *
 * The values are read from `interp.vars` when line 395 prints, not from the text
 * it printed: our PRINT rounds to six decimal places, which would hide exactly the
 * differences this spike is looking for.
 *
 * The runs, r1, r4a and r4b, are described in single-precision.ts.
 *
 * Usage: node spikes/oracle-precision/run-ours.ts <r1|r4a|r4b>
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInterpreter, VARIANTS } from './single-precision.ts';

const here = dirname(fileURLToPath(import.meta.url));
const COLUMNS = ['T', 'D', 'IV', 'N', 'A', 'M'];

const run = process.argv[2] ?? '';
if (!(run in VARIANTS)) {
  console.error(`usage: run-ours.ts <${Object.keys(VARIANTS).join('|')}>`);
  process.exit(2);
}

const { Basic } = await loadInterpreter(run);
const rows: string[] = [];
let transcript = '';
const interp = new Basic({
  print: (text) => {
    transcript += text;
    // Only line 395 prints a row; anything else is an error message.
    if (text.startsWith('\n?')) return;
    rows.push(COLUMNS.map((c) => String(interp.vars[c] ?? 0)).join(' '));
  },
});
interp.load(readFileSync(join(here, 'table3-trace.bas'), 'utf8'));
await interp.run();

if (transcript.includes('\n?')) {
  console.error(transcript.slice(transcript.indexOf('\n?')));
  process.exit(1);
}
mkdirSync(join(here, 'runs'), { recursive: true });
writeFileSync(join(here, 'runs', `${run}.txt`), rows.join('\n') + '\n');
console.log(`${run}: ${rows.length} rows`);
