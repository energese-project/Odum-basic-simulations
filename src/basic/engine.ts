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

/** How a step ended. `awaiting-input` is a suspension, not a failure. */
export type StepResult = 'more' | 'halted' | 'awaiting-input' | 'failed';

/**
 * One row the engine emitted, in the program's own coordinates.
 *
 * `screen`, `color` and `cls` set up the display rather than drawing on it —
 * a rasteriser needs the mode before it can size a buffer — so the stream is
 * an ordered record of everything the listing put out, not only its points.
 * `screen` carries its mode in `x`; `color` its background in `x` and palette
 * in `y`.
 */
export interface Row {
  kind: 'pset' | 'preset' | 'line' | 'print' | 'screen' | 'color' | 'cls';
  line: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  color: number;
  /** LINE's clause: 'B', 'BF', or null for everything else. */
  box: 'B' | 'BF' | null;
}

/**
 * A loaded program. Owns memory inside the module, so `free()` is not
 * optional — the instance outlives any one step, and a worker that loads a
 * new program without freeing the last one leaks the whole of its state.
 */
export interface Program {
  /** Run at most `maxStatements`, then return how it ended. */
  step(maxStatements: number): StepResult;
  /** What PRINT has produced since the last call. Empty string, never null. */
  takeText(): string;
  /**
   * Rows emitted so far, decoded, starting at `from`.
   *
   * The offset is not a convenience. A caller draining as it steps wants only
   * what is new, and decoding the whole array each time would make a long run
   * quadratic in its own output.
   */
  rows(from?: number): Row[];
  /** True when the program stopped at END or STOP and CONT would resume. */
  canContinue(): boolean;
  /** Resume after END or STOP, as CONT does. */
  cont(): void;
  /** The waiting INPUT's prompt, or null when none is waiting. */
  inputPrompt(): string | null;
  /** Supply one line. False when the statement wants more than it gave. */
  provideInput(line: string): boolean;
  /** The failure that stopped the program, or null. */
  error(): { message: string; line: number } | null;
  free(): void;
}

export interface Engine {
  /** Parse and check, without running. An empty array is a valid program. */
  validate(source: string): Diagnostic[];
  /** Parse and prepare to run. Throws if the source does not parse. */
  load(source: string): Program;
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
  BAS_Init(source: number, outInst: number): number;
  BAS_Free(inst: number): void;
  BAS_Step(inst: number, maxStatements: number): number;
  BAS_CanContinue(inst: number): number;
  BAS_Continue(inst: number): number;
  BAS_TakeText(inst: number, outText: number): number;
  BAS_GetInputPrompt(inst: number): number;
  BAS_ProvideInput(inst: number, line: number): number;
  BAS_GetRuntimeError(inst: number): number;
  BAS_GetRuntimeErrorLine(inst: number): number;
  BAS_GetRowCount(inst: number): number;
  BAS_GetRows(inst: number): number;
  _initialize?: () => void;
}

/** BAS_Status, as basic.h numbers them. */
const STATUS = {
  OK: 0,
  ERR_RUNTIME: 4,
  ERR_HALTED: 5,
  AWAITING_INPUT: 7,
} as const;

/** BAS_RowField, and BAS_ROW_STRIDE doubles to a row. */
const FIELD = { KIND: 0, LINE: 1, X0: 2, Y0: 3, X: 4, Y: 5, COLOR: 6, BOX: 7 } as const;
const ROW_STRIDE = 8;
const ROW_KINDS = ['pset', 'preset', 'line', 'print', 'screen', 'color', 'cls'] as const;
const BOXES = [null, 'B', 'BF'] as const;

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

  /** Read a pointer the module wrote into `ptr`. wasm32: pointers are 32-bit. */
  const readPtr = (ptr: number): number => u32()[ptr >>> 2] ?? 0;

  function load(source: string): Program {
    const sourcePtr = writeCString(source);
    const outPtr = exports.malloc(4);
    if (outPtr === 0) {
      exports.free(sourcePtr);
      throw new Error('the engine could not allocate for the instance');
    }
    let inst = 0;
    try {
      const status = exports.BAS_Init(sourcePtr, outPtr);
      if (status !== STATUS.OK) {
        // validate() says where; this only says that.
        throw new Error(`the listing did not load (status ${status})`);
      }
      inst = readPtr(outPtr);
      if (inst === 0) throw new Error('the engine returned no instance');
    } finally {
      exports.free(outPtr);
      exports.free(sourcePtr);
    }

    let freed = false;
    const alive = (): number => {
      if (freed) throw new Error('this program has been freed');
      return inst;
    };

    return {
      step(maxStatements: number): StepResult {
        switch (exports.BAS_Step(alive(), maxStatements)) {
          case STATUS.OK:
            return 'more';
          case STATUS.ERR_HALTED:
            return 'halted';
          case STATUS.AWAITING_INPUT:
            return 'awaiting-input';
          default:
            return 'failed';
        }
      },

      takeText(): string {
        const outText = exports.malloc(4);
        if (outText === 0) throw new Error('the engine could not allocate for the text');
        try {
          if (exports.BAS_TakeText(alive(), outText) !== STATUS.OK) return '';
          const textPtr = readPtr(outText);
          if (textPtr === 0) return '';
          const text = readCString(textPtr);
          exports.BAS_FreeString(textPtr);
          return text;
        } finally {
          exports.free(outText);
        }
      },

      rows(from = 0): Row[] {
        const count = exports.BAS_GetRowCount(alive());
        const base = exports.BAS_GetRows(alive());
        if (count === 0 || base === 0 || from >= count) return [];
        // A fresh view: a step may have grown the memory and detached the old
        // buffer, and BAS_GetRows says the array may move.
        const heap = new Float64Array(exports.memory.buffer, base, count * ROW_STRIDE);
        const out: Row[] = [];
        for (let i = from; i < count; i++) {
          const r = i * ROW_STRIDE;
          out.push({
            kind: ROW_KINDS[heap[r + FIELD.KIND]] ?? 'print',
            line: heap[r + FIELD.LINE],
            x0: heap[r + FIELD.X0],
            y0: heap[r + FIELD.Y0],
            x: heap[r + FIELD.X],
            y: heap[r + FIELD.Y],
            color: heap[r + FIELD.COLOR],
            box: BOXES[heap[r + FIELD.BOX]] ?? null,
          });
        }
        return out;
      },

      canContinue: (): boolean => exports.BAS_CanContinue(alive()) !== 0,

      cont(): void {
        exports.BAS_Continue(alive());
      },

      inputPrompt(): string | null {
        const ptr = exports.BAS_GetInputPrompt(alive());
        return ptr === 0 ? null : readCString(ptr);
      },

      provideInput(line: string): boolean {
        const linePtr = writeCString(line);
        try {
          return exports.BAS_ProvideInput(alive(), linePtr) === STATUS.OK;
        } finally {
          exports.free(linePtr);
        }
      },

      error(): { message: string; line: number } | null {
        const ptr = exports.BAS_GetRuntimeError(alive());
        if (ptr === 0) return null;
        return { message: readCString(ptr), line: exports.BAS_GetRuntimeErrorLine(alive()) };
      },

      free(): void {
        if (freed) return;
        freed = true;
        exports.BAS_Free(inst);
        inst = 0;
      },
    };
  }

  return {
    version: readCString(exports.BAS_GetVersionString()),
    load,

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
