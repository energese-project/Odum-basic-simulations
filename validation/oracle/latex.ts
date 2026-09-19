/**
 * The numbers docs/article.tex quotes from this attestation, as `oracle.tex`: a
 * macro for each number in the prose, and the comparison table. The article
 * \input's the file, so no number is copied by hand (AGENTS.md §14).
 *
 * The prose also makes claims these numbers could stop supporting — one threshold
 * step in every run, no pixel moved by precision, every screen difference caused
 * by PSET's rounding. Each claim is checked here, and a claim that no longer holds
 * stops the attestation with the paragraph to revise, rather than letting a macro
 * print a number the sentence around it contradicts.
 *
 * Usage: node validation/oracle/latex.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Comparisons, PairResult } from './compare.ts';
import type { Replay } from './replay.ts';
import type { ScreenCase } from './screens.ts';

const here = dirname(fileURLToPath(import.meta.url));
const json = <T>(name: string): T => JSON.parse(readFileSync(join(here, name), 'utf8')) as T;

const { pairs, bitwise, printRounding } = json<Comparisons>('comparisons.json');
const replay = json<Replay>('replay.json');
const screens = json<{ pixels: number; cases: ScreenCase[] }>('screens.json');

function claim(holds: boolean, what: string): void {
  if (!holds) {
    throw new Error(
      `The article's oracle paragraph (Section "Validation") says ${what}, and the runs no longer show it. ` +
        'Revise the text in docs/article.tex, then this check.',
    );
  }
}

const pair = (a: string, b: string): PairResult => {
  const p = pairs.find((q) => q.a === a && q.b === b);
  if (!p) throw new Error(`no comparison of ${a} with ${b}`);
  return p;
};
const pixelSteps = (p: PairResult): number => Object.values(p.pixels).reduce((n, s) => n + s.steps, 0);
const maxPixel = (p: PairResult): number => Math.max(...Object.values(p.pixels).map((s) => s.maxUnrounded));
const maxRel = (p: PairResult): number => Math.max(...Object.values(p.variables).map((v) => v.rel));
const screen = (image: string): ScreenCase => {
  const c = screens.cases.find((s) => s.image === image);
  if (!c) throw new Error(`no screen ${image}`);
  return c;
};

// ---------------------------------------------------------------- the claims

const steps = pairs[0].rows;
const thresholds = new Set(pairs.flatMap((p) => [p.threshold.a.step, p.threshold.b.step]));
claim(thresholds.size === 1 && !thresholds.has(null), 'that D > 30 first holds on the same step in every run');
const thresholdStep = [...thresholds][0] as number;
const thresholdT = pairs[0].threshold.a.T as number;

claim(
  pairs.every((p) => pixelSteps(p) === 0),
  'that every pair of runs lights the same pixel on every step',
);
const r1r2 = pair('r1', 'r2');
const r1r3d = pair('r1', 'r3d');
claim(maxRel(r1r3d) < 1e-11, "that PC-BASIC's double precision agrees with ours to the last digits");

const [r4a, r4b] = ['r4a', 'r4b'].map((r) => bitwise.find((b) => b.run === r)!);
claim(r4b.identical > r4a.identical && r4b.identical < r4b.rows, 'that R4b is closer than R4a, and still not bit-exact');

const asDrawn = screen('r1');
const halfEven = screen('r1-half-even');
claim(
  asDrawn.differing > 0 && screen('r4b').differing === asDrawn.differing,
  "that the site's screen differs from PC-BASIC's, and not because of precision",
);
claim(halfEven.differing === 0, 'that rounding PSET ties to even leaves no pixel different');

// ------------------------------------------------------------------ the file

/** A number for LaTeX: thousands grouped, small ones as a power of ten. */
function num(n: number, digits = 2): string {
  if (Number.isInteger(n)) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '{,}');
  const [m, e] = n.toExponential(digits - 1).split('e');
  return Number(e) > -3 ? n.toPrecision(digits) : `${m}\\times10^{${Number(e)}}`;
}
const containerfile = readFileSync(join(here, 'Containerfile'), 'utf8');
const version = (re: RegExp): string => re.exec(containerfile)?.[1] ?? '?';

const macros: [string, string][] = [
  ['oracleSteps', num(steps)],
  ['oracleThresholdStep', num(thresholdStep)],
  ['oracleThresholdT', String(thresholdT)],
  ['oracleSingleDoubleMaxRel', `$${num(maxRel(r1r2))}$`],
  ['oracleSingleDoubleMaxPx', `$${num(maxPixel(r1r2))}$`],
  ['oracleDoubleMaxRel', `$${num(maxRel(r1r3d))}$`],
  ['oracleBitIdenticalAssign', num(r4a.identical)],
  ['oracleBitIdenticalEvery', num(r4b.identical)],
  ['oracleReplaySteps', num(replay.steps)],
  ['oracleReplayDiffering', num(replay.stepsDiffering)],
  ['oracleScreenPixels', num(screens.pixels)],
  ['oracleScreenDiffering', num(asDrawn.differing)],
  ['oraclePrintValues', num(printRounding.values)],
  ['oraclePrintRoundedUp', num(printRounding.roundedUp)],
  ['oraclePcbasicVersion', version(/pcbasic==(\S+)/)],
  ['oraclePythonVersion', version(/python:(\d+\.\d+\.\d+)/)],
  ['oracleNodeVersion', process.version.slice(1)],
];

const LABELS: Record<string, string> = {
  r1: 'ours, double',
  r2: 'PC-BASIC, single',
  r3: 'PC-BASIC, \\texttt{DEFDBL}',
  r3d: 'PC-BASIC, double',
  r4a: 'ours, single on assignment',
  r4b: 'ours, single throughout',
};
const TABLE_PAIRS: [string, string][] = [
  ['r1', 'r2'],
  ['r1', 'r3'],
  ['r1', 'r3d'],
  ['r2', 'r4a'],
  ['r2', 'r4b'],
];
const series = Object.keys(r1r2.pixels).length;
/** r3d → R3d, as the text names the runs. */
const label = (run: string): string => run[0].toUpperCase() + run.slice(1);
const rows = TABLE_PAIRS.map(([a, b]) => {
  const p = pair(a, b);
  const bits = bitwise.find((r) => r.run === b);
  return [
    `${label(a)}--${label(b)}`,
    `${LABELS[a]} vs.\\ ${LABELS[b]}`,
    `$${num(maxRel(p))}$`,
    num(p.threshold.a.step as number),
    `${num(pixelSteps(p))} of ${num(p.rows * series)}`,
    `$${num(maxPixel(p))}$`,
    bits ? `${num(bits.identical)} of ${num(bits.rows)}` : '--',
  ].join(' & ') + ' \\\\';
});

const tex = [
  '%% Generated by validation/oracle/latex.ts from the attestation\'s runs. Do not edit:',
  '%% run `make attest-update`, then review the diff. docs/article.tex \\input\'s this file.',
  '',
  ...macros.map(([name, value]) => `\\newcommand{\\${name}}{${value}}`),
  '',
  '\\newcommand{\\oracleTable}{%',
  '\\begin{tabular}{@{}llccccc@{}}',
  '\\toprule',
  'Runs & Arithmetic & \\begin{tabular}[c]{@{}c@{}}Largest\\\\relative\\\\difference\\end{tabular} & \\begin{tabular}[c]{@{}c@{}}$D>30$\\\\from\\\\step\\end{tabular} & \\begin{tabular}[c]{@{}c@{}}Points on a\\\\different\\\\pixel\\end{tabular} & \\begin{tabular}[c]{@{}c@{}}Largest\\\\difference,\\\\pixels\\end{tabular} & \\begin{tabular}[c]{@{}c@{}}Steps\\\\bit-identical\\\\to R2\\end{tabular} \\\\',
  '\\midrule',
  ...rows,
  '\\bottomrule',
  '\\end{tabular}}',
  '',
].join('\n');

writeFileSync(join(here, 'oracle.tex'), tex);
