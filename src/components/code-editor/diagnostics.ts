/**
 * Listings checked as they are typed, by the C engine through wasm.
 *
 * The engine's BAS_Validate parses without executing and returns Monaco's own
 * marker shape, so this file is mostly plumbing: fetch the module once, debounce
 * the keystrokes, hand the diagnostics to setModelMarkers.
 *
 * Why the engine and not the TypeScript interpreter: validation is the one thing
 * the C engine can already do completely, and doing it here means the editor and
 * the command-line tool's `check` agree by construction rather than by two
 * implementations being kept in step. Running a listing is still the
 * interpreter's job — the engine has no INPUT and emits no text.
 *
 * Failure is silent by design. If the module cannot be fetched or instantiated,
 * the editor keeps working without markers; an editor that refuses to open
 * because a checker is missing would be a worse outcome than an unchecked one.
 */

import type * as monaco from 'monaco-editor/editor/editor.api.js';
import { instantiateEngine, type Diagnostic, type Engine } from '../../basic/engine.ts';
import engineWasmUrl from '../../basic/engine.wasm?url';

/** Whose markers these are. Monaco keys by owner, so ours replace only ours. */
const OWNER = 'basic';

/** Long enough that a burst of typing validates once, short enough to feel live. */
const DEBOUNCE_MS = 150;

let enginePromise: Promise<Engine | null> | null = null;

/** Fetched once per page and shared: the module is ~50 KB and stateless here. */
function engine(): Promise<Engine | null> {
  enginePromise ??= (async () => {
    try {
      const response = await fetch(engineWasmUrl);
      if (!response.ok) throw new Error(`${response.status} fetching the engine`);
      return await instantiateEngine(await response.arrayBuffer());
    } catch (cause) {
      // Once, not per keystroke. The editor carries on unchecked.
      console.warn('BASIC diagnostics are unavailable:', cause);
      return null;
    }
  })();
  return enginePromise;
}

function severityOf(
  api: typeof monaco,
  diagnostic: Diagnostic,
): monaco.MarkerSeverity {
  return diagnostic.severity === 'warning'
    ? api.MarkerSeverity.Warning
    : api.MarkerSeverity.Error;
}

/**
 * Check `model` now and whenever it changes, until the returned function is
 * called. Safe to call for a model that is disposed while a check is in flight.
 */
export function watchDiagnostics(
  api: typeof monaco,
  model: monaco.editor.ITextModel,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const check = async (): Promise<void> => {
    const bas = await engine();
    // The model can be replaced or disposed while the module is loading, and
    // setModelMarkers on a disposed model throws.
    if (!bas || disposed || model.isDisposed()) return;
    let diagnostics: Diagnostic[];
    try {
      diagnostics = bas.validate(model.getValue());
    } catch (cause) {
      console.warn('BASIC diagnostics failed:', cause);
      return;
    }
    if (disposed || model.isDisposed()) return;
    api.editor.setModelMarkers(
      model,
      OWNER,
      diagnostics.map((d) => ({
        severity: severityOf(api, d),
        message: d.message,
        code: d.code,
        startLineNumber: d.startLineNumber,
        startColumn: d.startColumn,
        endLineNumber: d.endLineNumber,
        endColumn: d.endColumn,
      })),
    );
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void check();
    }, DEBOUNCE_MS);
  };

  const subscription = model.onDidChangeContent(schedule);
  // A program that arrives already broken should say so before it is touched.
  void check();

  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    subscription.dispose();
  };
}
