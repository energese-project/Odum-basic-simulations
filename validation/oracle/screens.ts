/**
 * The stretch goal: the unmodified `table3.bas`, compared as screens.
 *
 * PC-BASIC's side is its CGA video memory, saved headless by the one line
 * `table3-screen.bas` adds: `410 DEF SEG=&HB800: BSAVE "SCREEN.BIN",0,&H4000`.
 * Ours is the same listing run in our interpreter, its DrawOps rasterised by
 * src/basic/screen.ts — the code the site's Plot pane uses.
 *
 * The two differ only where a point falls half-way between two pixels. GW-BASIC
 * rounds such a coordinate away from zero, as CINT does, and so does screen.ts;
 * PC-BASIC's PSET rounds it to even. `rounding.bas` records that PC-BASIC's own
 * CINT does not, and the third case shows that adjusting for it leaves nothing
 * else. See validation/KNOWN-DIFFERENCES.md.
 *
 * R5 is the C engine (engine/), which does not run in Node: it writes its rows as
 * CSV and they are replayed through the same `Screen` below. That is deliberate.
 * Comparing R5 with R1 then isolates the *engine*, because both sides go through
 * one rasteriser — if they differ, the arithmetic differs, not the drawing.
 *
 * Writes `screens.md`, `screens.json`, and `screens/<run>.png` for each screen and
 * for the difference, three times the size so that a printed figure stays sharp.
 * Usage: node validation/oracle/screens.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import type { DrawOp } from '../../src/basic/interpreter.ts';
import { Screen } from '../../src/basic/screen.ts';
import { loadInterpreter } from './single-precision.ts';

const here = dirname(fileURLToPath(import.meta.url));
const [W, H] = [320, 200];
/** Each screen pixel becomes SCALE × SCALE, nearest neighbour: a PDF viewer would otherwise blur 320 × 200. */
const SCALE = 3;

/**
 * SCREEN 1 memory: two bits a pixel, leftmost in the high bits, 80 bytes a row,
 * even rows from offset 0 and odd rows from &H2000. BSAVE puts a seven-byte
 * header in front: &HFD, segment, offset, length.
 */
function cga(file: string): Uint8Array {
  const bytes = readFileSync(file);
  if (bytes[0] !== 0xfd) throw new Error(`${file} is not a BSAVE file`);
  const data = bytes.subarray(7);
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = (y & 1) * 0x2000 + (y >> 1) * 80;
    for (let x = 0; x < W; x++) px[y * W + x] = (data[row + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
  }
  return px;
}

/** What PC-BASIC's PSET does with a coordinate exactly between two pixels: 0.5 → 0, 1.5 → 2. */
const halfToEven = (v: number): number => (Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : Math.round(v));

/**
 * `halfEven` rounds each PSET's point half to even before screen.ts sees it, which
 * would round it away from zero, as GW-BASIC does. Table 3's x, T / T0, is exactly
 * half a pixel on every other step.
 */
async function ours(run: string, halfEven: boolean): Promise<Uint8Array> {
  const { Basic } = await loadInterpreter(run);
  const screen = new Screen();
  const draw = (op: DrawOp): void =>
    screen.apply(halfEven && op.op === 'pset' ? { ...op, x: halfToEven(op.x), y: halfToEven(op.y) } : op);
  const interp = new Basic({ print: (t) => { throw new Error(`${run} printed: ${t}`); }, draw });
  interp.load(readFileSync(join(here, 'table3.bas'), 'utf8'));
  await interp.run();
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = screen.pixel(x, y);
  return px;
}

/**
 * The C engine's rows, replayed as DrawOps.  `SCREEN 1` is synthesised because
 * the CSV records only what was drawn, not the mode that was set; every listing
 * the archive compares this way is SCREEN 1, and a mode mismatch would show up
 * as a wholesale difference rather than a subtle one.
 */
function fromCsv(file: string): Uint8Array {
  const [header, ...lines] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const cols = header.split(',');
  const at = (row: string[], name: string): string => row[cols.indexOf(name)] ?? '';
  const screen = new Screen();
  screen.apply({ op: 'screen', mode: 1 });
  for (const text of lines) {
    const row = text.split(',');
    const num = (name: string): number => Number(at(row, name));
    const kind = at(row, 'kind');
    const line = num('line');
    const color = num('color');
    if (kind === 'pset' || kind === 'preset') {
      screen.apply({ op: 'pset', x: num('x'), y: num('y'), color, line });
    } else if (kind === 'line') {
      const box = at(row, 'box');
      screen.apply({
        op: 'line',
        x1: num('x0'), y1: num('y0'), x2: num('x'), y2: num('y'),
        color, box: box === 'B' || box === 'BF' ? box : null, line,
      });
    }
  }
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = screen.pixel(x, y);
  return px;
}

/** A minimal PNG: 8-bit RGB, one IDAT, no filtering, each screen pixel SCALE times over. */
function png(file: string, rgb: (i: number) => [number, number, number]): void {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const [w, h] = [W * SCALE, H * SCALE];
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      raw.set(rgb(Math.floor(y / SCALE) * W + Math.floor(x / SCALE)), y * (1 + w * 3) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// SCREEN 1, COLOR 0,0: palette 0 on black. Only for looking at; the comparison is by colour number.
const PALETTE_0: [number, number, number][] = [[0, 0, 0], [0, 0xaa, 0], [0xaa, 0, 0], [0xaa, 0x55, 0]];

/**
 * How far the reference screen is dimmed under the white difference pixels. A quarter,
 * which is what `>> 2` gave, survives on a monitor and not on paper: the brightest
 * palette colour lands at 42 of 255 on black, and the figure printed as white dots with
 * no curve under them. At 0.55 the curves are legible at print size and white is still
 * unambiguously the brightest thing on the screen (140 of 255 against it).
 */
const dim = (c: number): number => Math.round(c * 0.55);

const oracle = cga(join(here, 'runs', 'r2-screen.bin'));
mkdirSync(join(here, 'screens'), { recursive: true });
png(join(here, 'screens', 'r2.png'), (i) => PALETTE_0[oracle[i]]);

const out = [
  '# Screens',
  '',
  'Generated by `screens.ts`. Do not edit by hand.',
  '',
  "The unmodified `table3.bas`, PC-BASIC's CGA memory against our DrawOps rasterised by `src/basic/screen.ts`.",
  '',
  '| Run | Pixels differing, of 64000 | Lit only in PC-BASIC | Lit only in ours | Colour differs |',
  '| --- | --- | --- | --- | --- |',
];
const firstDiffs: string[] = [];
export interface ScreenCase {
  image: string;
  run: string;
  label: string;
  halfEven: boolean;
  differing: number;
  onlyOracle: number;
  onlyOurs: number;
  colour: number;
}
const cases: ScreenCase[] = [];
/** Each case's screen, kept so the runs can also be compared with each other. */
const buffers = new Map<string, Uint8Array>();
/** Image name, interpreter, label, and whether to round PSET's halves to even, as PC-BASIC does. */
const CASES: [string, string, string, boolean][] = [
  ['r1', 'r1', 'R1, as the site draws it', false],
  ['r4b', 'r4b', 'R4b, as the site draws it', false],
  ['r1-half-even', 'r1', "R1, adjusted to PC-BASIC's PSET, halves to even", true],
  ['r5', 'r5', 'R5, the C engine, as the site draws it', false],
];
for (const [image, run, label, halfEven] of CASES) {
  const px = run === 'r5' ? fromCsv(join(here, 'runs', 'r5.csv')) : await ours(run, halfEven);
  let [total, onlyOracle, onlyOurs, colour] = [0, 0, 0, 0];
  for (let i = 0; i < px.length; i++) {
    if (px[i] === oracle[i]) continue;
    total++;
    if (px[i] === 0) onlyOracle++;
    else if (oracle[i] === 0) onlyOurs++;
    else colour++;
    if (firstDiffs.length < 10 && image === 'r1') {
      firstDiffs.push(`| (${i % W}, ${Math.floor(i / W)}) | ${oracle[i]} | ${px[i]} |`);
    }
  }
  out.push(`| ${label} | ${total} | ${onlyOracle} | ${onlyOurs} | ${colour} |`);
  cases.push({ image, run, label, halfEven, differing: total, onlyOracle, onlyOurs, colour });
  buffers.set(image, px);
  png(join(here, 'screens', `${image}.png`), (i) => PALETTE_0[px[i]]);
  // White where the two differ, the PC-BASIC screen dimmed underneath.
  png(join(here, 'screens', `${image}-diff.png`), (i) =>
    px[i] !== oracle[i] ? [255, 255, 255] : (PALETTE_0[oracle[i]].map(dim) as [number, number, number]),
  );
}
if (firstDiffs.length) {
  out.push('', 'R1, the first pixels that differ:', '', '| (x, y) | PC-BASIC | Ours |', '| --- | --- | --- |', ...firstDiffs);
}

/**
 * The runs against each other, rather than against PC-BASIC.
 *
 * Equal counts in the table above are not the same claim as an equal screen:
 * two runs could differ from the oracle in the same number of pixels and not
 * in the same pixels. This compares them directly, so "the implementations
 * agree" is measured rather than inferred from a coincidence of totals.
 *
 * It is the strongest reproducibility statement the attestation makes. R1 is
 * TypeScript in double precision, R4b is TypeScript rounded to single after
 * every operation, and R5 is C in single precision by type — two languages and
 * two precisions, independently written, drawing one screen.
 */
export interface PairScreen {
  a: string;
  b: string;
  label: string;
  differing: number;
}
const PAIRS: [string, string, string][] = [
  ['r1', 'r5', 'R1 vs R5 — TypeScript, double, against C, single'],
  ['r1', 'r4b', 'R1 vs R4b — the same interpreter at two precisions'],
];
const pairScreens: PairScreen[] = PAIRS.map(([a, b, label]) => {
  const pa = buffers.get(a);
  const pb = buffers.get(b);
  if (!pa || !pb) throw new Error(`no screen for ${a} or ${b}`);
  let differing = 0;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) differing++;
  return { a, b, label, differing };
});
out.push(
  '',
  'The runs against each other. Differing from PC-BASIC in the same number of pixels is not the same as drawing the',
  'same screen; this is the direct comparison.',
  '',
  '| Comparison | Pixels differing, of 64000 |',
  '| --- | --- |',
  ...pairScreens.map((p) => `| ${p.label} | ${p.differing} |`),
);
/**
 * `rounding.bas`, in PC-BASIC: for each value n + 0.5, the column and the row its
 * PSET lit, read back with POINT, and its CINT of the same value. `-o` is the
 * text screen, so it is read as a stream of numbers, four to a row.
 */
export interface RoundingRow {
  value: number;
  psetX: number;
  psetY: number;
  cint: number;
}
const probe = readFileSync(join(here, 'runs', 'rounding.txt'), 'utf8').trim().split(/\s+/).map(Number);
if (probe.length === 0 || probe.length % 4 !== 0 || probe.some(Number.isNaN)) {
  throw new Error('runs/rounding.txt is not rows of four numbers');
}
const rounding: RoundingRow[] = [];
for (let i = 0; i < probe.length; i += 4) {
  rounding.push({ value: probe[i], psetX: probe[i + 1], psetY: probe[i + 2], cint: probe[i + 3] });
}
out.push(
  '',
  "PC-BASIC's rounding of a half, from `rounding.bas`: the pixel its `PSET` lit, read back with `POINT`, beside its own",
  "`CINT`. GW-BASIC reads graphics coordinates through the routine `CINT` uses (`FRCINT`, MATH2.ASM), so on the PC",
  'each point would land on the `CINT` column.',
  '',
  '| Coordinate | `PSET`, column | `PSET`, row | `CINT` |',
  '| --- | --- | --- | --- |',
  ...rounding.map((r) => `| ${r.value} | ${r.psetX} | ${r.psetY} | ${r.cint} |`),
);

const report = out.join('\n') + '\n';
writeFileSync(join(here, 'screens.md'), report);
writeFileSync(
  join(here, 'screens.json'),
  JSON.stringify({ pixels: W * H, cases, pairs: pairScreens, rounding }, null, 2) + '\n',
);
