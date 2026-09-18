/**
 * Normalising a CSS colour into the 6-digit hex Monaco insists on.
 *
 * This exists because of a dev/production divergence that is invisible until it
 * throws. The tokens in energese.css are written as 6-digit hex, but the
 * production CSS minifier shortens what it can: `--e-surface: #ffffff` is
 * served to the browser as `#fff`. `getComputedStyle` hands back whatever the
 * stylesheet says, so the same code reads `#ffffff` from the dev server and
 * `#fff` from the built bundle, and Monaco rejects the second with
 *
 *     Illegal value for token color: #fff
 *
 * — killing editor construction outright, leaving an empty mount and no clue.
 *
 * Kept free of any DOM reference so it can be unit-tested directly; everything
 * that reads the document lives in editor-theme.ts.
 */

const HEX_3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_4 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])[0-9a-f]$/i;
const HEX_6 = /^#?([0-9a-f]{6})$/i;
const HEX_8 = /^#?([0-9a-f]{6})[0-9a-f]{2}$/i;
// The sign is accepted so that a malformed channel reaches the clamp in pad()
// rather than failing the match and making the whole colour null.
const RGB = /^rgba?\(\s*([-+]?[\d.]+)[\s,]+([-+]?[\d.]+)[\s,]+([-+]?[\d.]+)/i;

function pad(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/**
 * Returns `#rrggbb`, or null when the value is not a colour this understands.
 *
 * Alpha is dropped rather than approximated: Monaco's token `rules` take no
 * alpha at all, and a token blended against an assumed background would be a
 * guess that looks right on one surface and wrong on the other.
 */
export function normaliseHex(value: string): string | null {
  const v = value.trim();
  if (v === '') return null;

  const six = HEX_6.exec(v) ?? HEX_8.exec(v);
  if (six) return `#${six[1].toLowerCase()}`;

  const three = HEX_3.exec(v) ?? HEX_4.exec(v);
  if (three) {
    return `#${three[1]}${three[1]}${three[2]}${three[2]}${three[3]}${three[3]}`.toLowerCase();
  }

  const rgb = RGB.exec(v);
  if (rgb) return `#${pad(Number(rgb[1]))}${pad(Number(rgb[2]))}${pad(Number(rgb[3]))}`;

  return null;
}
