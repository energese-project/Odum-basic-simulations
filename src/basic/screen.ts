/**
 * The IBM PC screen, rebuilt from what a listing drew on it.
 *
 * The interpreter records graphics statements as DrawOps in the program's own
 * coordinates; this turns them into pixels. It is kept apart from the record on
 * purpose: the pixels are how the run looked, which is what Odum's published
 * figures show, and the record is what the program computed, which is what a
 * plot is read back from.
 *
 * Only what the published listings use: SCREEN 1 (320×200, four colours from
 * one of two CGA palettes) and SCREEN 2 (640×200, two colours).
 *
 * Pure: no DOM. The site no longer shows a screen — it plots the points
 * (draw-plot.ts) — but validation/oracle/ rasterises every run through this.
 */

import type { DrawOp } from './interpreter.ts';

export type Rgb = readonly [number, number, number];

/** The sixteen CGA colours, by the number BASIC uses for them. */
export const CGA: readonly Rgb[] = [
  [0x00, 0x00, 0x00], // 0 black
  [0x00, 0x00, 0xaa], // 1 blue
  [0x00, 0xaa, 0x00], // 2 green
  [0x00, 0xaa, 0xaa], // 3 cyan
  [0xaa, 0x00, 0x00], // 4 red
  [0xaa, 0x00, 0xaa], // 5 magenta
  [0xaa, 0x55, 0x00], // 6 brown
  [0xaa, 0xaa, 0xaa], // 7 light grey
  [0x55, 0x55, 0x55], // 8 dark grey
  [0x55, 0x55, 0xff], // 9 light blue
  [0x55, 0xff, 0x55], // 10 light green
  [0x55, 0xff, 0xff], // 11 light cyan
  [0xff, 0x55, 0x55], // 12 light red
  [0xff, 0x55, 0xff], // 13 light magenta
  [0xff, 0xff, 0x55], // 14 yellow
  [0xff, 0xff, 0xff], // 15 white
];

/** SCREEN 1's colours 1–3 under each palette. Colour 0 is the background. */
const PALETTES: readonly (readonly number[])[] = [
  [2, 4, 6], // 0: green, red, brown
  [3, 5, 7], // 1: cyan, magenta, white
];

const SIZES: Record<number, { width: number; height: number }> = {
  1: { width: 320, height: 200 },
  2: { width: 640, height: 200 },
};

/**
 * The pixel a graphics coordinate lands on. GW-BASIC reads every coordinate of
 * PSET, PRESET and LINE through FRCINT, the routine CINT uses: it shifts the
 * magnitude right and adds back the first bit shifted out (`ADC BX,0` in
 * MATH2.ASM), so a half goes away from zero — 0.5 to 1, 2.5 to 3, -0.5 to -1.
 * `Math.round` agrees for x ≥ 0 but sends -0.5 to 0. PC-BASIC rounds halves to
 * even here, which GW-BASIC does not: validation/KNOWN-DIFFERENCES.md.
 */
function toPixel(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

export class Screen {
  mode = 0;
  width = 0;
  height = 0;
  private palette = 1;
  private background = 0;
  /** One colour number per pixel, row by row. */
  private pixels = new Uint8Array(0);

  apply(op: DrawOp): void {
    switch (op.op) {
      case 'screen': {
        const size = SIZES[op.mode] ?? { width: 0, height: 0 };
        this.mode = op.mode;
        this.width = size.width;
        this.height = size.height;
        this.pixels = new Uint8Array(size.width * size.height);
        this.palette = 1;
        this.background = 0;
        return;
      }
      case 'color':
        this.background = op.background;
        this.palette = op.palette;
        return;
      case 'cls':
        this.pixels.fill(0);
        return;
      case 'pset':
        this.plot(op.x, op.y, op.color);
        return;
      case 'line':
        if (op.box) this.box(op.x1, op.y1, op.x2, op.y2, op.color, op.box === 'BF');
        else this.line(op.x1, op.y1, op.x2, op.y2, op.color);
        return;
    }
  }

  /** The colour number at a pixel, or 0 off the screen. */
  pixel(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.pixels[y * this.width + x];
  }

  /** The RGB of each colour number, as the palette and background set them. */
  colours(): Rgb[] {
    if (this.mode === 2) return [CGA[0], CGA[15]];
    return [CGA[this.background], ...PALETTES[this.palette].map((c) => CGA[c])];
  }

  /** The screen as RGBA bytes, for a canvas's ImageData. */
  rgba(): Uint8ClampedArray<ArrayBuffer> {
    const colours = this.colours();
    const out = new Uint8ClampedArray(this.pixels.length * 4);
    this.pixels.forEach((c, i) => {
      const [r, g, b] = colours[c];
      out.set([r, g, b, 255], i * 4);
    });
    return out;
  }

  /** One pixel, nearest the point the program computed. */
  private plot(x: number, y: number, color: number): void {
    const px = toPixel(x);
    const py = toPixel(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    this.pixels[py * this.width + px] = color;
  }

  /** Bresenham, pixel by pixel, so a line running off the screen is clipped. */
  private line(x1: number, y1: number, x2: number, y2: number, color: number): void {
    // toPixel(NaN) is NaN, and a walk towards NaN never arrives. The
    // interpreter refuses such a coordinate; this does not rely on it.
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    let x = toPixel(x1);
    let y = toPixel(y1);
    const xEnd = toPixel(x2);
    const yEnd = toPixel(y2);
    const dx = Math.abs(xEnd - x);
    const dy = -Math.abs(yEnd - y);
    const sx = x < xEnd ? 1 : -1;
    const sy = y < yEnd ? 1 : -1;
    let err = dx + dy;
    // Bounded by the line's own length, which the interpreter holds to the PC's
    // 16-bit coordinates.
    for (;;) {
      this.plot(x, y, color);
      if (x === xEnd && y === yEnd) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  private box(x1: number, y1: number, x2: number, y2: number, color: number, fill: boolean): void {
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    const [left, right] = [toPixel(Math.min(x1, x2)), toPixel(Math.max(x1, x2))];
    const [top, bottom] = [toPixel(Math.min(y1, y2)), toPixel(Math.max(y1, y2))];
    if (fill) {
      // Only the part on the screen: a box can be 65536 pixels on a side.
      for (let y = Math.max(top, 0); y <= Math.min(bottom, this.height - 1); y++) {
        for (let x = Math.max(left, 0); x <= Math.min(right, this.width - 1); x++) this.plot(x, y, color);
      }
      return;
    }
    this.line(left, top, right, top, color);
    this.line(left, bottom, right, bottom, color);
    this.line(left, top, left, bottom, color);
    this.line(right, top, right, bottom, color);
  }
}
