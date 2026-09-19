/**
 * The listings the spike runs, derived from `table3.bas` so that none of them can
 * drift from it by hand:
 *
 * - `table3-trace.bas`: the graphics lines removed (they change no variable) and
 *   `395 PRINT T; D; IV; N; A; M` added before the loop test. R1, R2, R4.
 * - `table3-trace-defdbl.bas`: `1 DEFDBL A-Z` prepended. R3, as TODO.md specifies.
 * - `table3-trace-double.bas`: DEFDBL and a `#` on every numeric literal. R3d.
 * - `table3-trace-bits.bas`: the trace, with each value's bytes as well. R2 bits.
 * - `table3-screen.bas`: the listing unmodified, and one line after it that saves
 *   the CGA screen. The stretch goal, in screens.ts.
 *   Under DEFDBL alone GW-BASIC still parses `.033` as a single-precision literal
 *   and widens it (3.299999982118607D-02), so R3 is not a double-precision run.
 *
 * Usage: node validation/oracle/variants.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const GRAPHICS_LINES = new Set([4, 5, 6, 7, 310, 330, 360, 365]);
const TRACE_LINE = '395 PRINT T; D; IV; N; A; M';

const lines = readFileSync(join(here, 'table3.bas'), 'utf8').split(/\r?\n/).filter((l) => l.trim());
const number = (l: string): number => parseInt(/^\d+/.exec(l)![0], 10);

const trace = lines.filter((l) => !GRAPHICS_LINES.has(number(l)));
trace.splice(trace.findIndex((l) => number(l) > 395), 0, TRACE_LINE);

/** A `#` after every numeric literal, leaving line numbers, GOTO targets and REMs alone. */
function doubleLiterals(line: string): string {
  const m = /^(\d+\s+)(.*)$/.exec(line)!;
  if (/^REM\b/i.test(m[2])) return line;
  const [body, target] = m[2].split(/(?=\bGOTO\b)/i);
  const suffixed = body.replace(/(?<![A-Z0-9.])(\d+\.?\d*|\.\d+)(?![\d.#!%A-Z])/gi, '$1#');
  return m[1] + suffixed + (target ?? '');
}

const write = (name: string, body: string[]): void =>
  writeFileSync(join(here, name), body.join('\n') + '\n');

// The same trace, printing each variable's four bytes of Microsoft Binary Format
// (MKS$, exponent byte first) after the decimal row: seven printed digits cannot
// tell a one-ulp difference from agreement. It prints the step's intermediates
// too, R and the four rates, so replay.ts can find the statement where our single
// precision first parts from PC-BASIC's. The decimal row is there to prove this
// is R2's computation, text for text. V, X, X$ and J are unused by the listing.
const BITS = ['T', 'D', 'IV', 'N', 'A', 'M', 'R', 'DD', 'DN', 'DA', 'DM'];
const bits = trace.map((l) =>
  number(l) === 395
    ? `395 PRINT T; D; IV; N; A; M: FOR V = 1 TO ${BITS.length}: ` +
      `ON V GOSUB ${BITS.map((_, i) => 501 + i).join(', ')}: GOSUB 600: NEXT V: PRINT`
    : l,
);
bits.push(
  '410 END',
  ...BITS.map((v, i) => `${501 + i} X = ${v}: RETURN`),
  '600 X$ = MKS$(X): FOR J = 4 TO 1 STEP -1: PRINT RIGHT$("0" + HEX$(ASC(MID$(X$, J, 1))), 2);: NEXT J: PRINT " ";: RETURN',
);

write('table3-trace.bas', trace);
write('table3-screen.bas', [...lines, '410 DEF SEG=&HB800: BSAVE "SCREEN.BIN",0,&H4000']);
write('table3-trace-bits.bas', bits);
write('table3-trace-defdbl.bas', ['1 DEFDBL A-Z', ...trace]);
write('table3-trace-double.bas', ['1 DEFDBL A-Z', ...trace.map(doubleLiterals)]);
