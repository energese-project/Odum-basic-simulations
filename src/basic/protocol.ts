/** The messages crossing the Worker boundary. Shared by both sides so a change
 *  to one is a type error in the other. */

export type ToWorker =
  | { type: 'run'; source: string }
  | { type: 'input'; value: string }
  | { type: 'halt' };

export type FromWorker =
  | { type: 'out'; text: string }
  | { type: 'input-request' }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** How long output accumulates before being posted. A simulation printing a row
 *  per step produces tens of thousands of tiny strings; one message each would
 *  spend the whole run in structured-clone overhead and flood the main thread. */
export const FLUSH_MS = 40;
