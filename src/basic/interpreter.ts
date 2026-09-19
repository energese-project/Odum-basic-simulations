/**
 * A small, from-scratch interpreter for a BASIC V2-style dialect.
 *
 * No CPU emulation, no ROM images, nothing copyrighted — every behaviour here
 * is implemented directly. That matters for the purpose of this repository:
 * the programs are quoted from published books, and the thing that runs them
 * has to be redistributable.
 *
 * The interpreter knows nothing about the DOM. Its whole contact with the
 * outside world is the callbacks in `BasicIO`, which is what lets the same
 * class run on the main thread, in a Web Worker, or under `node --test`.
 *
 * Supported: PRINT (, ; separators), LET (optional), numeric and string
 * variables, 1-D and 2-D arrays (DIM), FOR/TO/STEP/NEXT, IF/THEN (line number
 * or statement), IF .. GOTO, GOSUB/RETURN, INPUT, DATA/READ/RESTORE, REM, END,
 * STOP, RANDOMIZE, and multiple statements per line via ':'. CONT, through
 * cont(), carries on after END or STOP.
 *
 * Graphics: SCREEN 1 and 2, COLOR, CLS, PSET, PRESET and LINE (with STEP, B
 * and BF). They draw nothing here: each is checked and handed to `draw` as a
 * DrawOp, and screen.ts turns those into the picture.
 *
 * Not yet supported: WHILE/WEND, DEF FN, ON..GOTO, SELECT CASE, PRINT USING.
 * See TODO.md.
 */

export class BasicError extends Error {}

export type BasicValue = number | string;

export interface BasicIO {
  /** Receives program output exactly as PRINT emits it, newlines included. */
  print: (text: string) => void;
  /** Called on INPUT. Resolves with one line of user input. */
  requestInput?: () => Promise<string>;
  /**
   * Called at every yield point, roughly every `YIELD_INTERVAL` statements.
   * Returning true halts the program as though it had hit END. Without it a
   * runaway FOR loop can only be stopped by tearing down the whole worker.
   */
  shouldHalt?: () => boolean;
  /**
   * Receives each graphics statement as it runs, in screen coordinates exactly
   * as the program computed them — not rounded to pixels, so a plot can be read
   * back from the record at the precision it was calculated.
   */
  draw?: (op: DrawOp) => void;
}

/** One graphics statement. `line` is the BASIC line that drew it. */
export type DrawOp =
  | { op: 'screen'; mode: number }
  | { op: 'color'; background: number; palette: number }
  | { op: 'cls' }
  | { op: 'pset'; x: number; y: number; color: number; line: number }
  | {
      op: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: number;
      box: 'B' | 'BF' | null;
      line: number;
    };

interface Point {
  x: number;
  y: number;
}

/** The modes a listing can draw in: width, height, and the highest colour. */
const SCREEN_MODES: Record<number, { width: number; height: number; maxColor: number }> = {
  1: { width: 320, height: 200, maxColor: 3 },
  2: { width: 640, height: 200, maxColor: 1 },
};

interface Line {
  num: number;
  stmts: string[];
}

interface Pc {
  lineIdx: number;
  stmtIdx: number;
}

interface ForFrame {
  varName: string;
  limit: number;
  step: number;
  bodyPc: Pc;
}

interface BasicArray {
  dims: number[];
  data: NestedArray;
}

type NestedArray = BasicValue[] | NestedArray[];

/** Statements between yields. Low enough to stay responsive, high enough that
 *  the await is not the dominant cost of a tight numeric loop. */
const YIELD_INTERVAL = 2000;

export class Basic {
  private readonly io: BasicIO;

  private lines: Line[] = [];
  private lineIndex: Record<number, number> = {};
  private arrays: Record<string, BasicArray> = {};
  private forStack: ForFrame[] = [];
  private gosubStack: Pc[] = [];
  private dataValues: string[] = [];
  private dataPtr = 0;
  private pc: Pc = { lineIdx: 0, stmtIdx: 0 };
  private running = false;
  private stopped = false;
  private jumped = false;
  /** Stopped by END or STOP with statements still to run: CONT may go on. */
  private resumable = false;

  /** 0 is text; SCREEN 1 or 2 is a graphics mode. */
  private screenMode = 0;
  private palette = 1;
  private background = 0;
  /** Where PSET and LINE last drew: LINE's default start, and STEP's origin. */
  private lastPoint: Point = { x: 0, y: 0 };

  /** Scalar variables. Public because the expression parser reads it. */
  vars: Record<string, BasicValue> = {};

  constructor(io: BasicIO) {
    this.io = io;
    this.reset();
  }

  private reset(): void {
    this.lines = [];
    this.lineIndex = {};
    this.vars = {};
    this.arrays = {};
    this.forStack = [];
    this.gosubStack = [];
    this.dataValues = [];
    this.dataPtr = 0;
    this.pc = { lineIdx: 0, stmtIdx: 0 };
    this.running = false;
    this.stopped = false;
    this.jumped = false;
    this.resumable = false;
    this.screenMode = 0;
    this.palette = 1;
    this.background = 0;
    this.lastPoint = { x: 0, y: 0 };
  }

  // ---------------------------------------------------------------- load

  load(source: string): void {
    this.reset();
    const raw = source
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsed: Line[] = [];
    for (const l of raw) {
      const m = /^(\d+)\s*(.*)$/.exec(l);
      if (!m) throw new BasicError(`Line missing a line number: "${l}"`);
      parsed.push({ num: parseInt(m[1], 10), stmts: splitStatements(m[2]) });
    }
    parsed.sort((a, b) => a.num - b.num);
    this.lines = parsed;
    this.lines.forEach((ln, i) => (this.lineIndex[ln.num] = i));

    // DATA is positional across the whole program, not scoped to where it sits,
    // so it is collected once at load time in line order.
    for (const ln of this.lines) {
      for (const s of ln.stmts) {
        const m = /^DATA\s+(.*)$/i.exec(s);
        if (!m) continue;
        for (const item of splitTopLevel(m[1], ',')) {
          const t = item.trim();
          this.dataValues.push(/^".*"$/.test(t) ? t.slice(1, -1) : t);
        }
      }
    }
  }

  // ----------------------------------------------------------------- run

  async run(): Promise<void> {
    this.pc = { lineIdx: 0, stmtIdx: 0 };
    return this.execute();
  }

  /** True after END or STOP with more of the program left to run. */
  get canContinue(): boolean {
    return this.resumable;
  }

  /**
   * CONT: carry on from the statement after the END or STOP that stopped the
   * program, with its variables, loops and screen as they were. Odum's 1989
   * macroeconomics listing ENDs after its first run and tells the reader to
   * "type CONT" for the second.
   */
  async cont(): Promise<void> {
    if (!this.resumable) {
      this.io.print("\n?CAN'T CONTINUE\n");
      return;
    }
    return this.execute();
  }

  private async execute(): Promise<void> {
    this.running = true;
    this.stopped = false;
    this.resumable = false;
    let steps = 0;

    while (this.running && this.pc.lineIdx < this.lines.length) {
      const ln = this.lines[this.pc.lineIdx];
      const stmt = ln.stmts[this.pc.stmtIdx];
      const nextPc = this.advance(ln);
      try {
        await this.exec(stmt, ln.num);
      } catch (e) {
        if (e instanceof BasicError) {
          this.io.print(`\n?${e.message} ERROR IN LINE ${ln.num}\n`);
          this.running = false;
          return;
        }
        throw e;
      }
      if (this.stopped) {
        this.pc = nextPc;
        this.resumable = this.pc.lineIdx < this.lines.length;
        return;
      }
      if (!this.jumped) this.pc = nextPc;
      this.jumped = false;

      if (++steps % YIELD_INTERVAL === 0) {
        // A macrotask, not a microtask: queueMicrotask or a bare await would
        // drain straight back into this loop without letting the event loop
        // deliver the stop message that shouldHalt is reading.
        await new Promise((r) => setTimeout(r, 0));
        if (this.io.shouldHalt?.()) {
          this.running = false;
          return;
        }
      }
    }
    this.running = false;
  }

  private advance(ln: Line): Pc {
    if (this.pc.stmtIdx + 1 < ln.stmts.length) {
      return { lineIdx: this.pc.lineIdx, stmtIdx: this.pc.stmtIdx + 1 };
    }
    return { lineIdx: this.pc.lineIdx + 1, stmtIdx: 0 };
  }

  private gotoLine(num: number): void {
    if (!(num in this.lineIndex)) throw new BasicError(`UNDEF'D STATEMENT`);
    this.pc = { lineIdx: this.lineIndex[num], stmtIdx: 0 };
    this.jumped = true;
  }

  // ---------------------------------------------------------- statements

  private async exec(stmt: string, lineNum: number): Promise<void> {
    const m = /^([A-Z?]+\$?)\s*(.*)$/i.exec(stmt);
    const kw = m ? m[1].toUpperCase() : '';
    const rest = m ? m[2] : '';

    switch (kw) {
      case 'REM':
        return;
      case 'PRINT':
      case '?':
        return this.doPrint(rest);
      case 'LET':
        return this.doLet(rest);
      case 'INPUT':
        return this.doInput(rest);
      case 'IF':
        return this.doIf(rest, lineNum);
      case 'FOR':
        return this.doFor(rest);
      case 'NEXT':
        return this.doNext(rest);
      case 'GOTO':
        return this.gotoLine(parseInt(rest.trim(), 10));
      case 'GOSUB': {
        this.gosubStack.push(this.advance(this.lines[this.pc.lineIdx]));
        return this.gotoLine(parseInt(rest.trim(), 10));
      }
      case 'RETURN': {
        const ret = this.gosubStack.pop();
        if (!ret) throw new BasicError('RETURN WITHOUT GOSUB');
        this.pc = ret;
        this.jumped = true;
        return;
      }
      case 'DIM':
        return this.doDim(rest);
      case 'READ':
        return this.doRead(rest);
      case 'RESTORE':
        this.dataPtr = 0;
        return;
      case 'DATA':
        return; // collected at load time
      case 'RANDOMIZE':
        // Accepted and ignored. RND is Math.random, which cannot be seeded, so
        // honouring this would mean shipping a PRNG and changing every existing
        // program's output. Silently erroring on it instead would stop the many
        // published listings that open with RANDOMIZE TIMER.
        return;
      case 'SCREEN':
        return this.doScreen(rest);
      case 'COLOR':
        return this.doColor(rest);
      case 'CLS':
        this.io.draw?.({ op: 'cls' });
        return;
      case 'PSET':
        return this.doPset(rest, lineNum, this.foreground());
      case 'PRESET':
        return this.doPset(rest, lineNum, 0);
      case 'LINE':
        return this.doLine(rest, lineNum);
      case 'END':
      case 'STOP':
        this.running = false;
        this.stopped = true;
        return;
      default:
        // Implicit LET: a bare `X = expr` or `A(I) = expr`.
        if (findTopLevelEquals(stmt) >= 0) return this.doLet(stmt);
        if (stmt.trim() === '') return;
        throw new BasicError(`SYNTAX (unknown statement "${stmt}")`);
    }
  }

  private doPrint(rest: string): void {
    if (!rest.trim()) {
      this.io.print('\n');
      return;
    }
    const parts = splitTopLevel(rest, [',', ';'], true);
    let out = '';
    for (const p of parts) {
      if (p.sep === ',') {
        out += '\t';
        continue;
      }
      if (p.sep === ';') continue;
      if (p.text.trim() === '') continue;
      out += stringify(evalExpr(p.text, this));
    }
    // A trailing separator suppresses the newline, which is how the published
    // listings build a row across several PRINT statements.
    this.io.print(out + (/[,;]\s*$/.test(rest) ? '' : '\n'));
  }

  private doLet(rest: string): void {
    const eq = findTopLevelEquals(rest);
    if (eq < 0) throw new BasicError('SYNTAX');
    const target = rest.slice(0, eq).trim();
    const value = evalExpr(rest.slice(eq + 1).trim(), this);
    this.assign(target, value);
  }

  assign(target: string, value: BasicValue): void {
    const arrMatch = /^([A-Z][A-Z0-9]*\$?)\s*\((.*)\)$/i.exec(target);
    if (arrMatch) {
      const name = arrMatch[1].toUpperCase();
      const idx = splitTopLevel(arrMatch[2], ',').map((e) => Math.trunc(toNum(evalExpr(e, this))));
      this.setArray(name, idx, value);
      return;
    }
    this.vars[target.toUpperCase()] = value;
  }

  private async doInput(rest: string): Promise<void> {
    let prompt = '';
    let varsPart = rest;
    const m = /^"([^"]*)"\s*[;,]\s*(.*)$/.exec(rest);
    if (m) {
      prompt = m[1];
      varsPart = m[2];
    }
    this.io.print(prompt + '? ');
    const raw = this.io.requestInput ? await this.io.requestInput() : '';
    const names = splitTopLevel(varsPart, ',').map((s) => s.trim());
    const values = raw.split(',');
    names.forEach((name, i) => {
      const v = (values[i] ?? '').trim();
      this.assign(name, /\$$/.test(name) ? v : Number(v) || 0);
    });
  }

  private async doIf(rest: string, lineNum: number): Promise<void> {
    // IF .. GOTO n, with no THEN: how the 1989 Simulation listings branch.
    const go = /^(.*?)\bGOTO\s*(\d+)\s*$/i.exec(rest);
    if (go && !/\bTHEN\b/i.test(go[1])) {
      if (evalExpr(go[1], this)) this.gotoLine(parseInt(go[2], 10));
      return;
    }
    const m = /^(.*?)\bTHEN\b\s*(.*)$/i.exec(rest);
    if (!m) throw new BasicError('SYNTAX (IF without THEN)');
    if (!evalExpr(m[1], this)) return;
    const action = m[2].trim();
    if (/^\d+$/.test(action)) return this.gotoLine(parseInt(action, 10));
    for (const s of splitStatements(action)) await this.exec(s, lineNum);
  }

  private doFor(rest: string): void {
    const m = /^([A-Z][A-Z0-9]*)\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i.exec(rest);
    if (!m) throw new BasicError('SYNTAX (bad FOR)');
    const varName = m[1].toUpperCase();
    this.vars[varName] = toNum(evalExpr(m[2], this));
    this.forStack.push({
      varName,
      limit: toNum(evalExpr(m[3], this)),
      step: m[4] ? toNum(evalExpr(m[4], this)) : 1,
      bodyPc: this.advance(this.lines[this.pc.lineIdx]),
    });
  }

  private doNext(rest: string): void {
    const varName = (rest.trim() || this.forStack.at(-1)?.varName || '').toUpperCase();
    let idx = -1;
    for (let i = this.forStack.length - 1; i >= 0; i--) {
      if (this.forStack[i].varName === varName) {
        idx = i;
        break;
      }
    }
    if (idx < 0) throw new BasicError('NEXT WITHOUT FOR');
    const frame = this.forStack[idx];
    const next = toNum(this.vars[frame.varName]) + frame.step;
    this.vars[frame.varName] = next;

    const done = frame.step >= 0 ? next > frame.limit : next < frame.limit;
    if (done) {
      // Leaving an inner NEXT also discards any frames opened above it, which is
      // what lets `FOR I .. FOR J .. NEXT I` unwind instead of leaking frames.
      this.forStack.splice(idx);
      return;
    }
    this.pc = frame.bodyPc;
    this.jumped = true;
  }

  // ------------------------------------------------------------ graphics

  private doScreen(rest: string): void {
    const [modeText] = splitTopLevel(rest, ',');
    const mode = Math.round(toNum(evalExpr(modeText, this)));
    if (mode !== 0 && !(mode in SCREEN_MODES)) throw new BasicError(`SCREEN ${mode} NOT SUPPORTED`);
    this.screenMode = mode;
    // What SCREEN leaves behind on the PC: palette 1 on black, and the last
    // point at the centre of the screen.
    this.palette = 1;
    this.background = 0;
    const size = SCREEN_MODES[mode];
    this.lastPoint = size ? { x: size.width / 2, y: size.height / 2 } : { x: 0, y: 0 };
    this.io.draw?.({ op: 'screen', mode });
  }

  /** In SCREEN 1: COLOR background, palette. In text mode it sets text colours,
   *  which the console does not show. SCREEN 2 is black and white only. */
  private doColor(rest: string): void {
    if (this.screenMode === 0) return;
    if (this.screenMode === 2) throw new BasicError('ILLEGAL FUNCTION CALL');
    const [bg, pal] = splitTopLevel(rest, ',').map((p) => p.trim());
    if (bg) this.background = Math.round(toNum(evalExpr(bg, this)));
    if (pal) this.palette = Math.round(toNum(evalExpr(pal, this))) % 2;
    if (this.background < 0 || this.background > 15) throw new BasicError('ILLEGAL FUNCTION CALL');
    this.io.draw?.({ op: 'color', background: this.background, palette: this.palette });
  }

  private foreground(): number {
    return SCREEN_MODES[this.screenMode]?.maxColor ?? 0;
  }

  private graphicsMode(): { width: number; height: number; maxColor: number } {
    const mode = SCREEN_MODES[this.screenMode];
    // As on the PC: there is nothing to draw on in text mode.
    if (!mode) throw new BasicError('ILLEGAL FUNCTION CALL');
    return mode;
  }

  /** A colour argument, which the mode must have. */
  private colour(text: string | undefined, fallback: number): number {
    if (text === undefined || text.trim() === '') return fallback;
    const color = Math.round(toNum(evalExpr(text, this)));
    if (color < 0 || color > this.graphicsMode().maxColor) throw new BasicError('ILLEGAL FUNCTION CALL');
    return color;
  }

  /**
   * `[STEP](x, y)` at the start of `text`, and whatever follows it. With STEP
   * the coordinates are relative to `origin`.
   */
  private point(text: string, origin: Point): Point & { rest: string } {
    const m = /^\s*(STEP\s*)?\(/i.exec(text);
    if (!m) throw new BasicError('SYNTAX (expected a point like (X, Y))');
    const open = m[0].length - 1;
    let depth = 0;
    let close = -1;
    let inStr = false;
    for (let i = open; i < text.length && close < 0; i++) {
      const ch = text[i];
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === '(') depth++;
      if (ch === ')' && --depth === 0) close = i;
    }
    if (close < 0) throw new BasicError('SYNTAX (missing ")")');
    const coords = splitTopLevel(text.slice(open + 1, close), ',');
    if (coords.length !== 2) throw new BasicError('SYNTAX (expected a point like (X, Y))');
    let x = toNum(evalExpr(coords[0], this));
    let y = toNum(evalExpr(coords[1], this));
    if (m[1]) {
      x += origin.x;
      y += origin.y;
    }
    // The PC held graphics coordinates as 16-bit integers. A diverging model
    // reaches this, and so does a NaN from LOG of a negative.
    if (![x, y].every((v) => Number.isFinite(v) && Math.round(v) >= -32768 && Math.round(v) <= 32767)) {
      throw new BasicError('OVERFLOW');
    }
    return { x, y, rest: text.slice(close + 1) };
  }

  private doPset(rest: string, lineNum: number, fallback: number): void {
    this.graphicsMode();
    const { x, y, rest: after } = this.point(rest, this.lastPoint);
    const args = after.trim();
    if (args && !args.startsWith(',')) throw new BasicError('SYNTAX');
    const color = this.colour(args ? args.slice(1) : undefined, fallback);
    this.lastPoint = { x, y };
    this.io.draw?.({ op: 'pset', x, y, color, line: lineNum });
  }

  /** LINE [[STEP](x1,y1)]-[STEP](x2,y2) [,[color][,B|BF]] */
  private doLine(rest: string, lineNum: number): void {
    this.graphicsMode();
    let text = rest.trim();
    let from: Point = this.lastPoint;
    if (/^(STEP\s*)?\(/i.test(text)) {
      const first = this.point(text, this.lastPoint);
      from = { x: first.x, y: first.y };
      text = first.rest.trim();
    }
    if (!text.startsWith('-')) throw new BasicError('SYNTAX (LINE needs "-" before its end point)');
    // A STEP end point is relative to the start of the line.
    const to = this.point(text.slice(1), from);

    const after = to.rest.trim();
    if (after && !after.startsWith(',')) throw new BasicError('SYNTAX');
    const [colorText, boxText, style] = after ? splitTopLevel(after.slice(1), ',') : [];
    if (style !== undefined) throw new BasicError('LINE STYLE NOT SUPPORTED');
    const boxArg = (boxText ?? '').trim().toUpperCase();
    if (boxArg !== '' && boxArg !== 'B' && boxArg !== 'BF') throw new BasicError('SYNTAX');
    const color = this.colour(colorText, this.foreground());

    this.lastPoint = { x: to.x, y: to.y };
    this.io.draw?.({
      op: 'line',
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      color,
      box: boxArg === '' ? null : (boxArg as 'B' | 'BF'),
      line: lineNum,
    });
  }

  private doDim(rest: string): void {
    for (const decl of splitTopLevel(rest, ',')) {
      const m = /^([A-Z][A-Z0-9]*\$?)\s*\((.*)\)$/i.exec(decl.trim());
      if (!m) throw new BasicError('SYNTAX (bad DIM)');
      const name = m[1].toUpperCase();
      // DIM A(10) is eleven cells: BASIC subscripts are inclusive from zero.
      const dims = splitTopLevel(m[2], ',').map(
        (e) => Math.trunc(toNum(evalExpr(e, this))) + 1
      );
      this.arrays[name] = { dims, data: makeNDArray(dims, /\$$/.test(name) ? '' : 0) };
    }
  }

  setArray(name: string, idx: number[], value: BasicValue): void {
    if (!this.arrays[name]) {
      const dims = idx.map(() => 11); // implicit DIM(10), as in the originals
      this.arrays[name] = { dims, data: makeNDArray(dims, /\$$/.test(name) ? '' : 0) };
    }
    let cell = this.arrays[name].data;
    for (let i = 0; i < idx.length - 1; i++) cell = cell[idx[i]] as NestedArray;
    (cell as BasicValue[])[idx[idx.length - 1]] = value;
  }

  getArray(name: string, idx: number[]): BasicValue {
    const arr = this.arrays[name];
    if (!arr) return /\$$/.test(name) ? '' : 0;
    let cell: NestedArray | BasicValue = arr.data;
    for (const i of idx) cell = (cell as NestedArray)[i];
    return cell as BasicValue;
  }

  private doRead(rest: string): void {
    for (const name of splitTopLevel(rest, ',')) {
      if (this.dataPtr >= this.dataValues.length) throw new BasicError('OUT OF DATA');
      const raw = this.dataValues[this.dataPtr++];
      const trimmed = name.trim();
      this.assign(trimmed, /\$$/.test(trimmed) ? String(raw) : Number(raw));
    }
  }
}

// ------------------------------------------------------------- helpers

function makeNDArray(dims: number[], fill: BasicValue): NestedArray {
  if (dims.length === 1) return new Array<BasicValue>(dims[0]).fill(fill);
  return Array.from({ length: dims[0] }, () => makeNDArray(dims.slice(1), fill));
}

function toNum(v: BasicValue): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** PRINT's number format: a leading space stands in for the absent minus sign. */
export function stringify(v: BasicValue): string {
  if (typeof v === 'number') return (v >= 0 ? ' ' : '') + trimNum(v);
  return String(v);
}

function trimNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e6) / 1e6);
}

/** Split a line body on ':' but not inside "strings", and not inside a REM. */
function splitStatements(body: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inStr = false;

  for (let i = 0; i < body.length; i++) {
    // REM comments out the rest of the LINE, colons included. Without this a
    // prose comment is chopped at its first colon and the remainder is executed
    // as a statement — which is how `REM ... sequence: a storage Q fed by` came
    // to be a syntax error.
    if (!inStr && /^\s*REM\b/i.test(cur)) {
      cur += body.slice(i);
      break;
    }
    const ch = body[i];
    if (ch === '"') inStr = !inStr;
    if (ch === ':' && !inStr) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }

  parts.push(cur);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

interface Chunk {
  text: string;
  sep: string | null;
}

function splitTopLevel(str: string, seps: string | string[]): string[];
function splitTopLevel(str: string, seps: string | string[], keepSep: true): Chunk[];
function splitTopLevel(
  str: string,
  seps: string | string[],
  keepSep = false
): string[] | Chunk[] {
  const sepList = Array.isArray(seps) ? seps : [seps];
  const plain: string[] = [];
  const chunks: Chunk[] = [];
  let cur = '';
  let depth = 0;
  let inStr = false;

  for (const ch of str) {
    if (ch === '"') inStr = !inStr;
    if (!inStr) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth === 0 && sepList.includes(ch)) {
        if (keepSep) {
          chunks.push({ text: cur, sep: null }, { text: '', sep: ch });
        } else {
          plain.push(cur);
        }
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (keepSep) {
    chunks.push({ text: cur, sep: null });
    return chunks;
  }
  plain.push(cur);
  return plain;
}

function findTopLevelEquals(str: string): number {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    // A relational '=' only appears inside IF, which strips its condition off
    // before this is reached, so a top-level '=' here is always an assignment.
    if (ch === '=' && depth === 0) return i;
  }
  return -1;
}

// -------------------------------------------------------- expression eval

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'rel'; v: string }
  | { t: '+' | '-' | '*' | '/' | '^' | '(' | ')' | ',' };

export function evalExpr(text: string, interp: Basic): BasicValue {
  return new ExprParser(tokenizeExpr(text), interp).parseOr();
}

function tokenizeExpr(str: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < str.length && str[j] !== '"') s += str[j++];
      toks.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      let s = '';
      while (j < str.length && /[0-9.]/.test(str[j])) s += str[j++];
      // Scientific notation: 1E-3 and 2.5E6 are everywhere in the published
      // rate coefficients, and without this the E would tokenize as a variable.
      if (/[Ee]/.test(str[j] ?? '') && /[0-9+-]/.test(str[j + 1] ?? '')) {
        s += str[j++];
        if (/[+-]/.test(str[j])) s += str[j++];
        while (j < str.length && /[0-9]/.test(str[j])) s += str[j++];
      }
      toks.push({ t: 'num', v: parseFloat(s) });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      let s = '';
      while (j < str.length && /[A-Za-z0-9]/.test(str[j])) s += str[j++];
      if (str[j] === '$') {
        s += '$';
        j++;
      }
      toks.push({ t: 'id', v: s.toUpperCase() });
      i = j;
      continue;
    }
    if ('+-*/^(),'.includes(ch)) {
      toks.push({ t: ch as '+' });
      i++;
      continue;
    }
    if ('<>='.includes(ch)) {
      let s = ch;
      i++;
      if ((s === '<' && (str[i] === '=' || str[i] === '>')) || (s === '>' && str[i] === '=')) {
        s += str[i];
        i++;
      }
      toks.push({ t: 'rel', v: s });
      continue;
    }
    throw new BasicError(`SYNTAX (bad char '${ch}')`);
  }
  return toks;
}

const FUNCS: Record<string, (a: BasicValue[]) => BasicValue> = {
  LEN: (a) => String(a[0]).length,
  MID$: (a) =>
    a[2] === undefined
      ? String(a[0]).slice(Math.trunc(toNum(a[1])) - 1)
      : String(a[0]).slice(
          Math.trunc(toNum(a[1])) - 1,
          Math.trunc(toNum(a[1])) - 1 + Math.trunc(toNum(a[2]))
        ),
  LEFT$: (a) => String(a[0]).slice(0, Math.trunc(toNum(a[1]))),
  RIGHT$: (a) => String(a[0]).slice(-Math.trunc(toNum(a[1]))),
  STR$: (a) => stringify(a[0]),
  CHR$: (a) => String.fromCharCode(Math.trunc(toNum(a[0]))),
  VAL: (a) => Number(String(a[0]).trim()) || 0,
  ASC: (a) => String(a[0]).charCodeAt(0),
  INT: (a) => Math.floor(toNum(a[0])),
  ABS: (a) => Math.abs(toNum(a[0])),
  SGN: (a) => Math.sign(toNum(a[0])),
  SQR: (a) => Math.sqrt(toNum(a[0])),
  SIN: (a) => Math.sin(toNum(a[0])),
  COS: (a) => Math.cos(toNum(a[0])),
  TAN: (a) => Math.tan(toNum(a[0])),
  ATN: (a) => Math.atan(toNum(a[0])),
  // EXP and LOG are not optional extras for this corpus. Exponential decay,
  // logistic growth and charge/discharge curves are most of what the published
  // mini-models compute, and every one of them needs these two.
  EXP: (a) => Math.exp(toNum(a[0])),
  LOG: (a) => Math.log(toNum(a[0])),
  RND: () => Math.random(),
};

class ExprParser {
  private pos = 0;
  private readonly toks: Token[];
  private readonly interp: Basic;

  constructor(toks: Token[], interp: Basic) {
    this.toks = toks;
    this.interp = interp;
  }

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }

  private next(): Token | undefined {
    return this.toks[this.pos++];
  }

  private expect(t: string): void {
    const tok = this.next();
    if (!tok || tok.t !== t) throw new BasicError('SYNTAX');
  }

  private isKeyword(word: string): boolean {
    const p = this.peek();
    return p?.t === 'id' && p.v === word;
  }

  parseOr(): BasicValue {
    let v = this.parseAnd();
    while (this.isKeyword('OR')) {
      this.next();
      v = v || this.parseAnd() ? 1 : 0;
    }
    return v;
  }

  private parseAnd(): BasicValue {
    let v = this.parseNot();
    while (this.isKeyword('AND')) {
      this.next();
      v = v && this.parseNot() ? 1 : 0;
    }
    return v;
  }

  private parseNot(): BasicValue {
    if (this.isKeyword('NOT')) {
      this.next();
      return this.parseRel() ? 0 : 1;
    }
    return this.parseRel();
  }

  private parseRel(): BasicValue {
    let v = this.parseAdd();
    let tok = this.peek();
    while (tok?.t === 'rel') {
      this.next();
      v = compareVals(v, this.parseAdd(), tok.v) ? 1 : 0;
      tok = this.peek();
    }
    return v;
  }

  private parseAdd(): BasicValue {
    let v = this.parseMul();
    let tok = this.peek();
    while (tok?.t === '+' || tok?.t === '-') {
      this.next();
      const rhs = this.parseMul();
      if (tok.t === '+') {
        v =
          typeof v === 'string' || typeof rhs === 'string'
            ? String(v) + String(rhs)
            : v + rhs;
      } else {
        v = toNum(v) - toNum(rhs);
      }
      tok = this.peek();
    }
    return v;
  }

  private parseMul(): BasicValue {
    let v = this.parseUnary();
    let tok = this.peek();
    while (tok?.t === '*' || tok?.t === '/') {
      this.next();
      const rhs = toNum(this.parseUnary());
      v = tok.t === '*' ? toNum(v) * rhs : toNum(v) / rhs;
      tok = this.peek();
    }
    return v;
  }

  private parseUnary(): BasicValue {
    const tok = this.peek();
    if (tok?.t === '-') {
      this.next();
      return -toNum(this.parseUnary());
    }
    if (tok?.t === '+') {
      this.next();
      return this.parseUnary();
    }
    return this.parsePow();
  }

  private parsePow(): BasicValue {
    const v = this.parsePrimary();
    if (this.peek()?.t === '^') {
      this.next();
      return Math.pow(toNum(v), toNum(this.parseUnary()));
    }
    return v;
  }

  private parsePrimary(): BasicValue {
    const tok = this.next();
    if (!tok) throw new BasicError('SYNTAX (unexpected end)');
    if (tok.t === 'num' || tok.t === 'str') return tok.v;
    if (tok.t === '(') {
      const v = this.parseOr();
      this.expect(')');
      return v;
    }
    if (tok.t === 'id') {
      if (FUNCS[tok.v] && this.peek()?.t === '(') {
        this.next();
        return FUNCS[tok.v](this.parseArgs());
      }
      if (this.peek()?.t === '(') {
        this.next();
        return this.interp.getArray(
          tok.v,
          this.parseArgs().map((a) => Math.trunc(toNum(a)))
        );
      }
      return this.interp.vars[tok.v] ?? (/\$$/.test(tok.v) ? '' : 0);
    }
    throw new BasicError('SYNTAX');
  }

  private parseArgs(): BasicValue[] {
    const args: BasicValue[] = [];
    if (this.peek()?.t === ')') {
      this.next();
      return args;
    }
    args.push(this.parseOr());
    while (this.peek()?.t === ',') {
      this.next();
      args.push(this.parseOr());
    }
    this.expect(')');
    return args;
  }
}

function compareVals(a: BasicValue, b: BasicValue, op: string): boolean {
  switch (op) {
    case '=':
      return a === b;
    case '<>':
      return a !== b;
    case '<':
      return a < b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    case '>=':
      return a >= b;
    default:
      throw new BasicError('SYNTAX');
  }
}
