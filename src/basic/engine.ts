/**
 * The C engine, in the browser.
 *
 * `engine.wasm` is built from engine/ by `make wasm` and committed, because the
 * site deploys with `npm ci && npm run build` on a runner that has Node and
 * nothing else. `make wasm-check` rebuilds it and fails if a byte moved, so the
 * committed binary cannot quietly stop following from the source.
 *
 * It is a standalone module with no emscripten JavaScript glue: `--no-entry`
 * and `-sSTANDALONE_WASM` emit a .wasm and nothing else, and the validation path
 * touches no stdio, so the only import to satisfy is the memory-growth notice
 * below. That is the whole reason this file is short.
 *
 * This module takes the bytes rather than fetching them, so `node --test` can
 * read them off disk and exercise the same code the browser runs. Fetching is
 * the caller's job — in the browser that is a Vite `?url` import.
 */

/** One problem with a listing, in the shape Monaco's setModelMarkers wants. */
export interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface Engine {
  /** Parse and check, without running. An empty array is a valid program. */
  validate(source: string): Diagnostic[];
  /** The engine's own version, as BAS_GetVersionString reports it. */
  readonly version: string;
}

interface Exports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  BAS_Validate(source: number, outJson: number): number;
  BAS_FreeString(ptr: number): void;
  BAS_GetVersionString(): number;
  _initialize?: () => void;
}

/** BAS_Status. 0 is success; the rest are failures to perform validation at all. */
const BAS_OK = 0;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Instantiate the engine from its bytes.
 *
 * Asynchronous because it has to be: browsers refuse synchronous compilation of
 * a module this size on the main thread, and the editor is on the main thread.
 * The cost is paid once — the caller holds the returned Engine and calls
 * validate() on it synchronously from then on, which is what lets this run on
 * every keystroke.
 */
export async function instantiateEngine(bytes: BufferSource): Promise<Engine> {
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      // ALLOW_MEMORY_GROWTH emits this so a JavaScript runtime can refresh a
      // cached view of the heap. Nothing here caches one — every read below
      // takes a fresh view, because growth detaches the old buffer — so there
      // is nothing to do, but the import must exist or instantiation fails.
      emscripten_notify_memory_growth: () => {},
    },
  });
  return engineFrom(instance.exports as unknown as Exports);
}

function engineFrom(exports: Exports): Engine {
  // A reactor module's static constructors run here. Nothing in the validation
  // path has any, but calling it is what the ABI asks for and costs nothing.
  exports._initialize?.();

  /** Fresh each time: growing the memory detaches every existing view. */
  const u8 = (): Uint8Array => new Uint8Array(exports.memory.buffer);
  const u32 = (): Uint32Array => new Uint32Array(exports.memory.buffer);

  function readCString(ptr: number): string {
    const heap = u8();
    let end = ptr;
    while (heap[end] !== 0) end++;
    // Copy before decoding: the buffer is wasm's, and it can move under us.
    return decoder.decode(heap.slice(ptr, end));
  }

  /** Copy a JavaScript string into wasm memory as NUL-terminated UTF-8. */
  function writeCString(text: string): number {
    const bytes = encoder.encode(text);
    const ptr = exports.malloc(bytes.length + 1);
    if (ptr === 0) throw new Error('the engine could not allocate for the source');
    const heap = u8();
    heap.set(bytes, ptr);
    heap[ptr + bytes.length] = 0;
    return ptr;
  }

  return {
    version: readCString(exports.BAS_GetVersionString()),

    validate(source: string): Diagnostic[] {
      const sourcePtr = writeCString(source);
      // BAS_Validate's second argument is char**, so it needs four bytes of
      // wasm memory to write the result pointer into. wasm32: pointers are 32-bit.
      const outPtr = exports.malloc(4);
      if (outPtr === 0) {
        exports.free(sourcePtr);
        throw new Error('the engine could not allocate for the result');
      }
      let jsonPtr = 0;
      try {
        const status = exports.BAS_Validate(sourcePtr, outPtr);
        if (status !== BAS_OK) {
          throw new Error(`the engine could not validate the listing (status ${status})`);
        }
        jsonPtr = u32()[outPtr >>> 2] ?? 0;
        if (jsonPtr === 0) throw new Error('the engine returned no diagnostics document');
        const parsed = JSON.parse(readCString(jsonPtr)) as { diagnostics?: Diagnostic[] };
        // A program with errors is a successful validation; so is one without.
        return parsed.diagnostics ?? [];
      } finally {
        if (jsonPtr !== 0) exports.BAS_FreeString(jsonPtr);
        exports.free(outPtr);
        exports.free(sourcePtr);
      }
    },
  };
}
