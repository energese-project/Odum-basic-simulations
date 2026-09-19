/**
 * Our interpreter, as it is or rewritten to emulate single precision with
 * Math.fround. Shared by run-ours.ts and replay.ts.
 *
 *   r1   the interpreter as it is, in 64-bit doubles
 *   r4a  Math.fround on assignment only
 *   r4b  Math.fround on assignment, on every literal and after every + - * / ^
 *
 * R4 is a spike-only hack and is never merged into src/. It is made here, by
 * rewriting a copy of interpreter.ts into .work/, and every rewrite must match
 * exactly once, so a change to the interpreter breaks this loudly rather than
 * leaving a variant that silently rounds nothing.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type InterpreterModule = typeof import('../../src/basic/interpreter.ts');

const here = dirname(fileURLToPath(import.meta.url));
const interpreterPath = join(here, '..', '..', 'src', 'basic', 'interpreter.ts');

const ON_ASSIGNMENT: [string, string][] = [
  [
    'this.vars[target.toUpperCase()] = value;',
    "this.vars[target.toUpperCase()] = typeof value === 'number' ? Math.fround(value) : value;",
  ],
];

// Rounding a double result of two singles to single is the correctly rounded
// single result, for + - * and / (53 >= 2 * 24 + 2), so this is IEEE single
// arithmetic exactly. It is not Microsoft Binary Format, which is the point of R4.
const ON_EVERY_OPERATION: [string, string][] = [
  ...ON_ASSIGNMENT,
  ["toks.push({ t: 'num', v: parseFloat(s) });", "toks.push({ t: 'num', v: Math.fround(parseFloat(s)) });"],
  [': v + rhs;', ': Math.fround(v + rhs);'],
  ['v = toNum(v) - toNum(rhs);', 'v = Math.fround(toNum(v) - toNum(rhs));'],
  [
    "v = tok.t === '*' ? toNum(v) * rhs : toNum(v) / rhs;",
    "v = Math.fround(tok.t === '*' ? toNum(v) * rhs : toNum(v) / rhs);",
  ],
  [
    'return Math.pow(toNum(v), toNum(this.parseUnary()));',
    'return Math.fround(Math.pow(toNum(v), toNum(this.parseUnary())));',
  ],
];

export const VARIANTS: Record<string, [string, string][] | null> = {
  r1: null,
  r4a: ON_ASSIGNMENT,
  r4b: ON_EVERY_OPERATION,
};

export async function loadInterpreter(run: string): Promise<InterpreterModule> {
  const rewrites = VARIANTS[run];
  if (rewrites === null) return import(pathToFileURL(interpreterPath).href);
  let source = readFileSync(interpreterPath, 'utf8');
  for (const [from, to] of rewrites) {
    const count = source.split(from).length - 1;
    if (count !== 1) throw new Error(`${run}: expected one "${from}" in interpreter.ts, found ${count}`);
    source = source.replace(from, to);
  }
  const work = join(here, '.work');
  mkdirSync(work, { recursive: true });
  const file = join(work, `interpreter-${run}.ts`);
  writeFileSync(file, source);
  return import(pathToFileURL(file).href);
}
