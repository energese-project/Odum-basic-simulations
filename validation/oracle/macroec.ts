/**
 * MACROEC — Odum (1989), Table 2 — compared as screens, as Table 3 is in screens.ts.
 *
 * The listing is programs/odum_simulation_1989/macroeconomics/model.bas, the
 * archived verbatim transcription, and every run below takes it unmodified. It is
 * two experiments on one screen: the first, with unlimited resources, ends at line
 * 450 END; the second, with renewable resources, is reached by typing CONT, and
 * draws over the first because line 480 returns to line 100 and skips the CLS.
 * Odum's Figure 3 shows the two together, and so is compared here twice: the
 * screen as the first run left it, and as both left it.
 *
 * PC-BASIC's side is its CGA memory, saved at the Ok prompt: run.sh feeds the
 * emulator what a reader typed — a BSAVE, CONT, a BSAVE — on stdin. Nothing is
 * added to the listing, unlike table3-screen.bas, because a direct-mode BSAVE
 * does what a line 410 had to do there.
 *
 * The prompt prints on the same bitmap as the plot. run.sh confines it to text row
 * 24 (y 184-191, below the frame at 180), but two rows at the top are beyond its
 * reach: the Ok that GW-BASIC prints when the first run ends, and the echo of the
 * VIEW PRINT that does the confining. Those three text rows hold characters, not
 * the model, so they are counted apart from the comparison rather than in it — and
 * the count is reported, so nothing is hidden by leaving them out.
 *
 * Ours is two implementations:
 *   R5  the C engine, `odum run` without and with `--cont 1`, its CSV replayed
 *       through src/basic/screen.ts by fromCsv();
 *   R1  the TypeScript interpreter, run() then cont(), drawing into the same
 *       Screen directly.
 * Both go through one rasteriser, so a difference between them is arithmetic.
 *
 * Writes macroec.md, macroec.json and screens/macroec-*.png.
 * Usage: node validation/oracle/macroec.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DrawOp } from '../../src/basic/interpreter.ts';
import { Screen } from '../../src/basic/screen.ts';
import { cga, dim, fromCsv, H, PALETTE_0, png, W } from './cga.ts';
import { loadInterpreter } from './single-precision.ts';

const here = dirname(fileURLToPath(import.meta.url));
const LISTING = join(here, '..', '..', 'programs', 'odum_simulation_1989', 'macroeconomics', 'model.bas');

/** The TypeScript interpreter's screen after the first run, and after CONT. */
async function r1(): Promise<[Uint8Array, Uint8Array]> {
  const { Basic } = await loadInterpreter('r1');
  const screen = new Screen();
  const interp = new Basic({
    print: (t) => { throw new Error(`MACROEC printed: ${t}`); },
    draw: (op: DrawOp) => screen.apply(op),
  });
  interp.load(readFileSync(LISTING, 'utf8'));
  const snap = (): Uint8Array => {
    const px = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = screen.pixel(x, y);
    return px;
  };
  await interp.run();
  const first = snap();
  if (!interp.canContinue) throw new Error('MACROEC ended its first run with nothing for CONT to resume');
  await interp.cont();
  return [first, snap()];
}

/** The text rows the prompt writes into: 1-2 at the top, and row 24. */
const TEXT = (y: number): boolean => y < 16 || (y >= 184 && y < 192);
const PLOT_PIXELS = W * H - W * (16 + 8);

export interface MacroecCase {
  image: string;
  label: string;
  stage: 'run1' | 'both';
  /** Pixels differing in the plot, every row but the prompt's text rows. */
  differing: number;
  /** Pixels differing in the prompt's text rows, reported and not compared. */
  text: number;
  onlyOracle: number;
  onlyOurs: number;
  colour: number;
}
export interface MacroecPair {
  a: string;
  b: string;
  label: string;
  differing: number;
}

const oracle = {
  run1: cga(join(here, 'runs', 'macroec-run1.bin')),
  both: cga(join(here, 'runs', 'macroec-run2.bin')),
};
const [r1First, r1Both] = await r1();
const ours: [string, string, 'run1' | 'both', Uint8Array][] = [
  ['macroec-r5-run1', 'R5, the C engine, after the first run', 'run1', fromCsv(join(here, 'runs', 'macroec-r5-run1.csv'))],
  ['macroec-r5', 'R5, the C engine, after CONT', 'both', fromCsv(join(here, 'runs', 'macroec-r5.csv'))],
  ['macroec-r1-run1', 'R1, the TypeScript interpreter, after the first run', 'run1', r1First],
  ['macroec-r1', 'R1, the TypeScript interpreter, after CONT', 'both', r1Both],
];

mkdirSync(join(here, 'screens'), { recursive: true });
png(join(here, 'screens', 'macroec-pcbasic-run1.png'), (i) => PALETTE_0[oracle.run1[i]]);
png(join(here, 'screens', 'macroec-pcbasic.png'), (i) => PALETTE_0[oracle.both[i]]);

const cases: MacroecCase[] = [];
const buffers = new Map<string, Uint8Array>();
for (const [image, label, stage, px] of ours) {
  const ref = oracle[stage];
  let [differing, text, onlyOracle, onlyOurs, colour] = [0, 0, 0, 0, 0];
  for (let i = 0; i < px.length; i++) {
    if (px[i] === ref[i]) continue;
    if (TEXT(Math.floor(i / W))) { text++; continue; }
    differing++;
    if (px[i] === 0) onlyOracle++;
    else if (ref[i] === 0) onlyOurs++;
    else colour++;
  }
  cases.push({ image, label, stage, differing, text, onlyOracle, onlyOurs, colour });
  buffers.set(image, px);
  png(join(here, 'screens', `${image}.png`), (i) => PALETTE_0[px[i]]);
  png(join(here, 'screens', `${image}-diff.png`), (i) =>
    px[i] !== ref[i] ? [255, 255, 255] : (PALETTE_0[ref[i]].map(dim) as [number, number, number]),
  );
}

// The two implementations against each other: C in single precision, TypeScript in double.
const pairs: MacroecPair[] = [
  ['macroec-r5-run1', 'macroec-r1-run1', 'R5 vs R1 after the first run — C, single, against TypeScript, double'],
  ['macroec-r5', 'macroec-r1', 'R5 vs R1 after CONT'],
].map(([a, b, label]) => {
  const pa = buffers.get(a)!;
  const pb = buffers.get(b)!;
  let differing = 0;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) differing++;
  return { a, b, label, differing };
});

const lit = (px: Uint8Array): number =>
  px.reduce((n, c, i) => n + (c !== 0 && !TEXT(Math.floor(i / W)) ? 1 : 0), 0);
const report = [
  '# MACROEC screens',
  '',
  'Generated by `macroec.ts`. Do not edit by hand.',
  '',
  'Odum (1989), Table 2, the archived verbatim listing, run unmodified. PC-BASIC was given `VIEW PRINT 24 TO 24`,',
  '`DEF SEG=&HB800`, a `BSAVE`, `CONT` and a `BSAVE` at its Ok prompt, as a reader would type them; ours ran it with',
  '`odum run --cont 1` (R5) and `run()` then `cont()` (R1).',
  '',
  "The prompt prints on the plot's bitmap. Its text rows — y 0-15, the first run's `Ok` and the echoed `VIEW PRINT`,",
  'and y 184-191, where `VIEW PRINT 24 TO 24` keeps the rest — are counted apart and not compared: they hold',
  `characters, not the model. That leaves ${PLOT_PIXELS} pixels of plot, in which PC-BASIC lit ${lit(oracle.run1)} after the`,
  `first run and ${lit(oracle.both)} after both.`,
  '',
  `| Run | Screen | Plot pixels differing, of ${PLOT_PIXELS} | Lit only in PC-BASIC | Lit only in ours | Colour differs | Text-row pixels differing, not compared |`,
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...cases.map((c) =>
    `| ${c.label} | ${c.stage === 'run1' ? 'first run' : 'both runs'} | ${c.differing} | ${c.onlyOracle} | ${c.onlyOurs} | ${c.colour} | ${c.text} |`),
  '',
  'The implementations against each other:',
  '',
  '| Comparison | Pixels differing, of 64000 |',
  '| --- | --- |',
  ...pairs.map((p) => `| ${p.label} | ${p.differing} |`),
  '',
].join('\n');
writeFileSync(join(here, 'macroec.md'), report);
writeFileSync(
  join(here, 'macroec.json'),
  JSON.stringify({ pixels: W * H, plotPixels: PLOT_PIXELS, lit: { run1: lit(oracle.run1), both: lit(oracle.both) }, cases, pairs }, null, 2) + '\n',
);
process.stdout.write(report);
