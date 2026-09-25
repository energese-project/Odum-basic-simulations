/**
 * Screens, as the oracle comparisons read and write them: PC-BASIC's CGA memory
 * decoded from a BSAVE file, the C engine's CSV rows replayed through
 * src/basic/screen.ts, and the PNGs both are written out as.
 *
 * Shared by screens.ts (Table 3) and macroec.ts (Table 2), so the two published
 * listings are compared by one decoder and one rasteriser. Nothing here runs on
 * import.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Screen } from '../../src/basic/screen.ts';

export const [W, H] = [320, 200];
/** Each screen pixel becomes SCALE × SCALE, nearest neighbour: a PDF viewer would otherwise blur 320 × 200. */
export const SCALE = 3;

/**
 * SCREEN 1 memory: two bits a pixel, leftmost in the high bits, 80 bytes a row,
 * even rows from offset 0 and odd rows from &H2000. BSAVE puts a seven-byte
 * header in front: &HFD, segment, offset, length.
 */
export function cga(file: string): Uint8Array {
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
export const halfToEven = (v: number): number => (Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : Math.round(v));

/**
 * The C engine's rows, replayed as DrawOps.
 *
 * The mode used to be synthesised here, because the CSV recorded only what was
 * drawn and not the screen it was drawn on. The engine records SCREEN, COLOR
 * and CLS now, so the replay follows the listing rather than assuming it — an
 * assumption that would have held until the first listing using SCREEN 2.
 */
export function fromCsv(file: string): Uint8Array {
  const [header, ...lines] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const cols = header.split(',');
  const at = (row: string[], name: string): string => row[cols.indexOf(name)] ?? '';
  const screen = new Screen();
  for (const text of lines) {
    const row = text.split(',');
    const num = (name: string): number => Number(at(row, name));
    const kind = at(row, 'kind');
    const line = num('line');
    const color = num('color');
    if (kind === 'screen') {
      screen.apply({ op: 'screen', mode: num('x') });
    } else if (kind === 'cls') {
      screen.apply({ op: 'cls' });
    } else if (kind === 'color') {
      screen.apply({ op: 'color', background: num('x'), palette: num('y') });
    } else if (kind === 'pset' || kind === 'preset') {
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
export function png(file: string, rgb: (i: number) => [number, number, number]): void {
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
export const PALETTE_0: [number, number, number][] = [[0, 0, 0], [0, 0xaa, 0], [0xaa, 0, 0], [0xaa, 0x55, 0]];

/**
 * How far the reference screen is dimmed under the white difference pixels. A quarter,
 * which is what `>> 2` gave, survives on a monitor and not on paper: the brightest
 * palette colour lands at 42 of 255 on black, and the figure printed as white dots with
 * no curve under them. At 0.55 the curves are legible at print size and white is still
 * unambiguously the brightest thing on the screen (140 of 255 against it).
 */
export const dim = (c: number): number => Math.round(c * 0.55);
