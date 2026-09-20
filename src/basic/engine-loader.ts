/**
 * The one instance of the wasm engine, and its state, shared across the page.
 *
 * Two things want it: the editor, which validates on every keystroke, and the
 * status light in the topbar, which says whether that is happening. They must
 * agree, so the module is fetched once here rather than once per consumer —
 * and the light reports the state of the engine the editor is actually using,
 * not of a second copy that happens to load at the same time.
 *
 * Browser-only, because of the `?url` import. The marshalling it wraps lives in
 * engine.ts, which takes bytes and so can be tested under `node --test`.
 */

import { instantiateEngine, type Engine } from './engine.ts';
import engineWasmUrl from './engine.wasm?url';

/**
 * `loading` covers "not started yet" as well as "in flight". Nothing can
 * distinguish them from outside, and a light that reads *starting up* for both
 * is honest about each.
 */
export type EngineStatus = 'loading' | 'ready' | 'unavailable';

let status: EngineStatus = 'loading';
let pending: Promise<Engine | null> | null = null;
const listeners = new Set<(status: EngineStatus) => void>();

function settle(next: EngineStatus): void {
  status = next;
  for (const listener of listeners) listener(status);
}

/** Start the load if it has not started, and resolve to the engine or to null. */
export function engine(): Promise<Engine | null> {
  pending ??= (async () => {
    try {
      const response = await fetch(engineWasmUrl);
      if (!response.ok) throw new Error(`${response.status} fetching the engine`);
      const loaded = await instantiateEngine(await response.arrayBuffer());
      settle('ready');
      return loaded;
    } catch (cause) {
      // Once, not per keystroke. Everything that uses the engine degrades
      // rather than failing, so this warning is the only trace otherwise.
      console.warn('The BASIC engine could not be loaded:', cause);
      settle('unavailable');
      return null;
    }
  })();
  return pending;
}

/** What the engine is doing now. */
export function engineStatus(): EngineStatus {
  return status;
}

/**
 * Watch the status, and start the load if nothing has yet. The callback fires
 * immediately with the current value, so a subscriber never has to ask twice.
 * Returns the unsubscribe.
 */
export function onEngineStatus(listener: (status: EngineStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  void engine();
  return () => {
    listeners.delete(listener);
  };
}
