/// <reference lib="webworker" />

/**
 * The interpreter, off the main thread.
 *
 * A mini-model integrating a few thousand steps is fast, but it is not
 * instantaneous, and on the main thread it would freeze the page — including
 * the editor the program was typed into. Here it can run flat out, and the UI
 * stays live enough to show output arriving and to offer a stop button.
 *
 * INPUT works because the interpreter is async all the way down: requestInput
 * posts a question and awaits a promise that the next 'input' message resolves.
 * No SharedArrayBuffer and no Atomics.wait, which is what makes this deployable
 * to GitHub Pages — those need COOP/COEP headers that Pages will not send.
 */

import { Basic, BasicError, type DrawOp } from './interpreter.ts';
import { FLUSH_MS, type FromWorker, type ToWorker } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: FromWorker): void {
  ctx.postMessage(msg);
}

let buffer = '';
let drawn: DrawOp[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingInput: ((value: string) => void) | null = null;
let halted = false;
/** Kept after END or STOP, for CONT. Replaced by the next run. */
let interp: Basic | null = null;

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

function print(text: string): void {
  buffer += text;
  flushTimer ??= setTimeout(flush, FLUSH_MS);
}

/** A plotting loop draws as often as a table prints, so it is batched the same way. */
function draw(op: DrawOp): void {
  drawn.push(op);
  flushTimer ??= setTimeout(flush, FLUSH_MS);
}

/** Run the program, or carry it on, and report how it stopped. */
function execute(start: (program: Basic) => Promise<void>): void {
  const program = interp;
  if (!program) return;
  void (async () => {
    try {
      await start(program);
      flush();
      post({ type: 'done', canContinue: program.canContinue });
    } catch (e) {
      flush();
      const message = e instanceof BasicError || e instanceof Error ? e.message : String(e);
      post({ type: 'error', message });
    }
  })();
}

function requestInput(): Promise<string> {
  // Whatever has been printed so far includes the prompt, and the user cannot
  // sensibly answer a question they have not been shown yet.
  flush();
  post({ type: 'input-request' });
  return new Promise<string>((resolve) => {
    pendingInput = resolve;
  });
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
    // An INPUT in flight would otherwise leave run() awaiting forever, and the
    // halt check only runs between statements.
    const resolve = pendingInput;
    pendingInput = null;
    resolve?.('');
    return;
  }

  if (msg.type === 'run') {
    halted = false;
    buffer = '';
    drawn = [];
    interp = new Basic({ print, draw, requestInput, shouldHalt: () => halted });
    execute(async (program) => {
      program.load(msg.source);
      await program.run();
    });
    return;
  }

  if (msg.type === 'cont') {
    halted = false;
    execute((program) => program.cont());
  }
});
