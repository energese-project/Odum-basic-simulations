/**
 * Reading `runs/r2-bits.txt`: each step is R2's decimal row, `T D IV N A M`, then
 * the variables in `BITS` as four bytes of Microsoft Binary Format each, exponent
 * byte first, as MKS$ holds them. Must match BITS in variants.ts.
 */

import { readFileSync } from 'node:fs';

export const BITS = ['T', 'D', 'IV', 'N', 'A', 'M', 'R', 'DD', 'DN', 'DA', 'DM'] as const;
export type BitsRow = Record<(typeof BITS)[number], number>;
const DECIMALS = 6;

/**
 * One MBF single: exponent byte, then the sign bit and 23 bits of mantissa. The
 * value is 0.1m × 2^(e − 128), which is 1.m × 2^(e − 129); an exponent of 0 is zero.
 * Every MBF single in IEEE single's exponent range is exactly representable here.
 */
export function mbf(hex: string): number {
  const e = parseInt(hex.slice(0, 2), 16);
  const m = parseInt(hex.slice(2), 16);
  if (e === 0) return 0;
  return (m & 0x800000 ? -1 : 1) * (1 + (m & 0x7fffff) / 2 ** 23) * 2 ** (e - 129);
}

export function readBits(file: string): { rows: BitsRow[]; decimal: string[] } {
  const tokens = readFileSync(file, 'utf8').trim().split(/\s+/);
  const width = DECIMALS + BITS.length;
  if (tokens.length % width) throw new Error(`${file}: ${tokens.length} tokens is not whole rows`);
  const rows: BitsRow[] = [];
  const decimal: string[] = [];
  for (let i = 0; i < tokens.length; i += width) {
    decimal.push(...tokens.slice(i, i + DECIMALS));
    rows.push(Object.fromEntries(BITS.map((c, j) => [c, mbf(tokens[i + DECIMALS + j])])) as BitsRow);
  }
  return { rows, decimal };
}

const f32 = new Float32Array(1);
const i32 = new Int32Array(f32.buffer);
/** Distance between two singles in units in the last place, across zero too. */
export function ulps(a: number, b: number): number {
  const ordered = (v: number): number => {
    f32[0] = v;
    return i32[0] < 0 ? -(i32[0] & 0x7fffffff) : i32[0];
  };
  return Math.abs(ordered(a) - ordered(b));
}
