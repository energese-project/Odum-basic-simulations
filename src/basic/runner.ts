/**
 * Main-thread half of the worker protocol.
 *
 * Owns one worker for the page's lifetime and restarts it only when a program
 * has to be killed. A cooperative halt is tried first — the interpreter checks
 * `shouldHalt` at its yield points, so a well-behaved program stops with its
 * output intact. Terminating is the fallback for the case that motivated the
 * worker in the first place: a listing whose loop never reaches a yield because
 * it never completes a statement.
 */

import { type FromWorker, type ToWorker } from './protocol.ts';

export interface RunnerHandlers {
  onOutput: (text: string) => void;
  onInputRequest: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

const HALT_GRACE_MS = 250;

export class Runner {
  private worker: Worker | null = null;
  private haltTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly handlers: RunnerHandlers;

  constructor(handlers: RunnerHandlers) {
    this.handlers = handlers;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // `new URL(..., import.meta.url)` is the form Vite recognises statically, so
    // the worker is bundled and hashed for production instead of being fetched
    // as a bare source path that only exists in dev.
    const worker = new Worker(new URL('./runner.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'out':
          this.handlers.onOutput(msg.text);
          break;
        case 'input-request':
          this.handlers.onInputRequest();
          break;
        case 'done':
          this.clearHaltTimer();
          this.handlers.onDone();
          break;
        case 'error':
          this.clearHaltTimer();
          this.handlers.onError(msg.message);
          break;
      }
    });
    worker.addEventListener('error', (event) => {
      this.handlers.onError(event.message || 'The interpreter worker failed to start');
    });
    this.worker = worker;
    return worker;
  }

  private send(msg: ToWorker): void {
    this.ensureWorker().postMessage(msg);
  }

  run(source: string): void {
    this.send({ type: 'run', source });
  }

  sendInput(value: string): void {
    this.send({ type: 'input', value });
  }

  /** Ask the program to stop; kill the worker if it does not. */
  halt(): void {
    if (!this.worker) return;
    this.send({ type: 'halt' });
    this.clearHaltTimer();
    this.haltTimer = setTimeout(() => {
      this.terminate();
      this.handlers.onDone();
    }, HALT_GRACE_MS);
  }

  terminate(): void {
    this.clearHaltTimer();
    this.worker?.terminate();
    this.worker = null;
  }

  private clearHaltTimer(): void {
    if (this.haltTimer !== null) {
      clearTimeout(this.haltTimer);
      this.haltTimer = null;
    }
  }
}
