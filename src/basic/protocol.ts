/** The messages crossing the Worker boundary. Shared by both sides so a change
 *  to one is a type error in the other. */

import type { DrawOp } from './interpreter.ts';

export type ToWorker =
  | { type: 'run'; source: string }
  /** CONT: carry on after END or STOP, in the program that stopped. */
  | { type: 'cont' }
  | { type: 'input'; value: string }
  | { type: 'halt' };

export type FromWorker =
  | { type: 'out'; text: string }
  /** Graphics statements since the last flush, in the order they ran. */
  | { type: 'draw'; ops: DrawOp[] }
  | { type: 'input-request' }
  /** `canContinue`: stopped by END or STOP with more of the program to run. */
  | { type: 'done'; canContinue: boolean }
  | { type: 'error'; message: string };

/** How long output accumulates before being posted. A simulation printing a row
 *  per step produces tens of thousands of tiny strings; one message each would
 *  spend the whole run in structured-clone overhead and flood the main thread. */
export const FLUSH_MS = 40;
