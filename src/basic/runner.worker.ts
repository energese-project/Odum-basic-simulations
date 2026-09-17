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

import { Basic, BasicError } from './interpreter.ts';
import { FLUSH_MS, type FromWorker, type ToWorker } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: FromWorker): void {
  ctx.postMessage(msg);
}

let buffer = '';
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingInput: ((value: string) => void) | null = null;
let halted = false;

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer === '') return;
  post({ type: 'out', text: buffer });
  buffer = '';
}

function print(text: string): void {
  buffer += text;
  flushTimer ??= setTimeout(flush, FLUSH_MS);
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
    const interp = new Basic({ print, requestInput, shouldHalt: () => halted });
    void (async () => {
      try {
        interp.load(msg.source);
        await interp.run();
        flush();
        post({ type: 'done' });
      } catch (e) {
        flush();
        const message = e instanceof BasicError || e instanceof Error ? e.message : String(e);
        post({ type: 'error', message });
      }
    })();
  }
});
