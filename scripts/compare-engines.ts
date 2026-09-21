/**
 * Every archive listing through both interpreters, printed side by side.
 *
 * The site runs the TypeScript interpreter in double precision; the C engine
 * computes in single, as the machines these listings were written for did.
 * Moving execution across is therefore a change of arithmetic, and this says
 * exactly what it costs before anything is moved: which printed values differ,
 * by how much, and whether the recovered plot moves with them.
 *
 *   node scripts/compare-engines.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { Basic } from '../src/basic/interpreter.ts';
import { instantiateEngine, type Program } from '../src/basic/engine.ts';
import { extractPlot } from '../src/basic/output.ts';

const wasm = readFileSync(new URL('../src/basic/engine.wasm', import.meta.url));
const engine = await instantiateEngine(wasm);

/** Run to completion under the C engine, returning what it printed. */
function runEngine(source: string): string {
  const program: Program = engine.load(source);
  let text = '';
  for (let guard = 0; guard < 100_000; guard++) {
    const result = program.step(4096);
    text += program.takeText();
    if (result !== 'more') break;
  }
  program.free();
  return text;
}

async function runTs(source: string): Promise<string> {
  let text = '';
  const interp = new Basic({ print: (t) => (text += t) });
  interp.load(source);
  await interp.run();
  return text;
}

const dir = new URL('../programs/', import.meta.url);
// A listing that asks for input is not a simulation to compare: fed a constant
// it either loops forever or takes a path that says nothing about arithmetic.
// guess.bas is the only one, and it is an `original` benchmark rather than a
// model from the literature.
const listings = readdirSync(dir)
  .filter((f) => f.endsWith('.bas'))
  .filter((f) => !readFileSync(new URL(f, dir), 'utf8').includes('INPUT'))
  .sort();

for (const file of listings) {
  const source = readFileSync(new URL(file, dir), 'utf8');
  let ts: string;
  try {
    ts = await runTs(source);
  } catch (e) {
    console.log(`\n${file}\n  TypeScript interpreter failed: ${(e as Error).message}`);
    continue;
  }
  const c = runEngine(source);

  const a = extractPlot(ts);
  const b = extractPlot(c);
  console.log(`\n${file}`);
  console.log(`  text identical: ${ts === c}`);
  if (!a || !b) {
    console.log(`  plot recovered: ts=${!!a} engine=${!!b}`);
    continue;
  }
  // The plot is what the site draws, so a difference here is a visible one.
  let worst = 0;
  let worstAt = '';
  const rows = Math.min(a.series[0].points.length, b.series[0].points.length);
  for (let s = 0; s < Math.min(a.series.length, b.series.length); s++) {
    for (let i = 0; i < rows; i++) {
      const d = Math.abs(a.series[s].points[i].y - b.series[s].points[i].y);
      if (d > worst) {
        worst = d;
        worstAt = `${a.series[s].label ?? `series ${s}`} row ${i}`;
      }
    }
  }
  const peak = Math.max(...a.series.flatMap((s) => s.points.map((p) => Math.abs(p.y))));
  console.log(`  series: ${a.series.length} vs ${b.series.length}, rows: ${a.series[0].points.length} vs ${b.series[0].points.length}`);
  console.log(`  largest difference: ${worst.toExponential(3)} at ${worstAt}`);
  console.log(`  as a fraction of peak (${peak.toPrecision(6)}): ${(worst / peak).toExponential(3)}`);
}
