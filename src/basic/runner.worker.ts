/// <reference lib="webworker" />

/**
 * The C engine, off the main thread.
 *
 * A mini-model integrating a few thousand steps is fast, but it is not
 * instantaneous, and on the main thread it would freeze the page — including
 * the editor the program was typed into. Here it can run flat out, and the UI
 * stays live enough to show output arriving and to offer a stop button.
 *
 * This is the engine the editor checks listings with, compiled to WebAssembly,
 * so the archive is now executed by the implementation whose arithmetic is
 * single precision as the original machines' was. It is instantiated again
 * here rather than shared: a Worker has its own memory.
 *
 * The protocol did not change when execution moved. The engine suspends on
 * INPUT rather than reading, which is the shape this file already had, so the
 * promise the main thread resolves still works — with no SharedArrayBuffer and
 * no Atomics.wait, which is what keeps it deployable to GitHub Pages.
 */

import type { DrawOp } from './interpreter.ts';
import { instantiateEngine, type Engine, type Program, type Row } from './engine.ts';
import { FLUSH_MS, type FromWorker, type ToWorker } from './protocol.ts';
import engineWasmUrl from './engine.wasm?url';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: FromWorker): void {
  ctx.postMessage(msg);
}

/**
 * Statements per step, matching the yield interval the TypeScript interpreter
 * used. Output has to arrive in pieces for a long run to look alive, and a
 * stop has to be acted on between steps rather than after the program ends.
 */
const STEP_BUDGET = 2_000;

let buffer = '';
let drawn: DrawOp[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingInput: ((value: string) => void) | null = null;
let halted = false;
/** Kept after END or STOP, for CONT. Replaced by the next run. */
let program: Program | null = null;
/**
 * How many of the program's rows have been posted. It belongs to the program,
 * not to one drive(): CONT drives the same program again, and a cursor starting
 * from zero there re-posted every point the first run drew. On a screen that
 * redrew the same pixels and went unseen; plotted, it put run 1 inside run 2.
 */
let cursor = 0;
let enginePromise: Promise<Engine> | null = null;

function engine(): Promise<Engine> {
  enginePromise ??= (async () => {
    const response = await fetch(engineWasmUrl);
    if (!response.ok) throw new Error(`${response.status} fetching the engine`);
    return instantiateEngine(await response.arrayBuffer());
  })();
  return enginePromise;
}

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  // Drawing and printing are separate panes, so their order across one flush
  // does not matter; within each, it is kept.
  if (drawn.length > 0) {
    post({ type: 'draw', ops: drawn });
    drawn = [];
  }
  if (buffer === '') return;
  post({ type: 'out', text: buffer });
  buffer = '';
}

function scheduleFlush(): void {
  flushTimer ??= setTimeout(flush, FLUSH_MS);
}

/**
 * A row as the screen understands it, or null for a printed column — the text
 * already carries those, and the plot is recovered from the text.
 */
function toDrawOp(row: Row): DrawOp | null {
  switch (row.kind) {
    case 'screen':
      return { op: 'screen', mode: row.x };
    case 'color':
      return { op: 'color', background: row.x, palette: row.y };
    case 'cls':
      return { op: 'cls' };
    case 'pset':
    case 'preset':
      // PRESET is a PSET of the background colour, and the engine has already
      // resolved which that was, so both arrive here the same way.
      return { op: 'pset', x: row.x, y: row.y, color: row.color, line: row.line };
    case 'line':
      return {
        op: 'line',
        x1: row.x0,
        y1: row.y0,
        x2: row.x,
        y2: row.y,
        color: row.color,
        box: row.box,
        line: row.line,
      };
    default:
      return null;
  }
}

function requestInput(): Promise<string> {
  // Whatever has been printed so far includes the prompt the listing wrote,
  // and a reader cannot sensibly answer a question not yet shown.
  flush();
  post({ type: 'input-request' });
  return new Promise<string>((resolve) => {
    pendingInput = resolve;
  });
}

/** Let queued messages — a stop, an answer — reach the handler. */
const yieldToMessages = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Step until the program stops, is stopped, or fails, draining as it goes. */
async function drive(): Promise<void> {
  const running = program;
  if (!running) return;

  for (;;) {
    if (halted) {
      flush();
      post({ type: 'done', canContinue: false, resumeLine: 0 });
      return;
    }

    const result = running.step(STEP_BUDGET);

    const text = running.takeText();
    if (text !== '') {
      buffer += text;
      scheduleFlush();
    }
    const rows = running.rows(cursor);
    if (rows.length > 0) {
      cursor += rows.length;
      for (const row of rows) {
        const op = toDrawOp(row);
        if (op) drawn.push(op);
      }
      scheduleFlush();
    }

    if (result === 'awaiting-input') {
      // The engine suspends without printing: it does not own a console, so
      // the prompt and the "? " are written here, where one exists. GW-BASIC
      // appends "? " after a semicolon, which is the form every INPUT in the
      // archive uses.
      const prompt = running.inputPrompt();
      buffer += `${prompt ?? ''}? `;
      const value = await requestInput();
      if (halted) continue;
      // False means the statement wants more than the line gave, and the
      // engine stays suspended: the next turn of the loop asks again.
      running.provideInput(value);
      continue;
    }

    if (result === 'failed') {
      flush();
      const failure = running.error();
      post({
        type: 'error',
        message: failure ? `${failure.message} in line ${failure.line}` : 'the program failed',
      });
      return;
    }

    if (result === 'halted') {
      flush();
      post({ type: 'done', canContinue: running.canContinue(), resumeLine: running.resumeLine() });
      return;
    }

    await yieldToMessages();
  }
}

ctx.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const msg = event.data;

  if (msg.type === 'input') {
    const resolve = pendingInput;
    pendingInput = null;
    resolve?.(msg.value);
    return;
  }

  if (msg.type === 'halt') {
    halted = true;
    // An INPUT in flight would otherwise leave drive() awaiting forever, and
    // the halt check only runs between steps.
    const resolve = pendingInput;
    pendingInput = null;
    resolve?.('');
    return;
  }

  if (msg.type === 'run') {
    halted = false;
    buffer = '';
    drawn = [];
    void (async () => {
      try {
        const bas = await engine();
        // The previous program owns memory inside the module; dropping the
        // reference without freeing it would leak all of that.
        program?.free();
        program = bas.load(msg.source);
        cursor = 0;
        await drive();
      } catch (e) {
        flush();
        post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return;
  }

  if (msg.type === 'cont') {
    halted = false;
    void (async () => {
      try {
        program?.cont();
        await drive();
      } catch (e) {
        flush();
        post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }
});
