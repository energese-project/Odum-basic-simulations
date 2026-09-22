# Odum BASIC Simulations

A browser workbench for the BASIC simulation listings in the systems-ecology
literature. Pick a program, read it, edit it, run it, and watch the column of
numbers it prints become a curve.

**[Open it →](https://energese-project.github.io/Odum-basic-simulations/)**

The language core is written from scratch: no CPU emulation, no ROM image, nothing
copyrighted. That is what lets the whole thing ship as a static page. It exists twice
over — an engine in C compiled to WebAssembly, which is what runs your listing, and an
interpreter in TypeScript kept as a reference implementation — so that the two can be
checked against each other rather than either being taken on trust.

## Built to last

This is an archive, so it is built to keep working for as long as there are
browsers, and to be understandable by whoever maintains it long after the people
who wrote it have moved on. Two rules follow, and they are constraints on every
change, not preferences:

- **Native platform first, third-party code last.** Vanilla Web Components, ES
  modules, the DOM. The runtime dependencies are Monaco and Chart.js, both bundled
  so nothing is fetched from a CDN, and that list is meant to stay short. Vite,
  TypeScript and Playwright are build and test tooling and are exempt — they are
  not in the shipped page. Every dependency is one more thing that has to still
  exist, still build and still be understood in ten years.
- **Test first.** Every change starts with a failing test. The language core's
  behaviour is pinned, in both implementations, by tests that run a BASIC listing and
  assert on what it printed; the archive's rules are pinned by tests phrased as the mistakes a
  contributor could make. A change without a test is a change nobody can safely
  make again.

[AGENTS.md](AGENTS.md) has the detail.

## What it is made of

| Piece | Where |
| --- | --- |
| **BASIC engine in C** — runs every listing | [`engine/`](engine/) → [`src/basic/engine.wasm`](src/basic/engine.wasm) |
| BASIC interpreter, DOM-free — the reference implementation | [`src/basic/interpreter.ts`](src/basic/interpreter.ts) |
| Runs off the main thread | [`src/basic/runner.worker.ts`](src/basic/runner.worker.ts), [`runner.ts`](src/basic/runner.ts) |
| Output → plottable series | [`src/basic/output.ts`](src/basic/output.ts) |
| **The program archive** | [`programs/`](programs/) |
| Editor, chart, console | [`src/components/`](src/components/) |

The editor is Monaco — the editor out of VS Code — bundled from npm, with no CDN
at runtime. The BASIC grammar is hand-written in
[`src/basic/basic-language.ts`](src/basic/basic-language.ts): Monaco ships 81
languages and none of them is this one. The two with "basic" in the name are
`sb` (Small Basic) and `vb` (Visual Basic), neither of which has line numbers.
The chart is Chart.js. The framework is [Boba](https://github.com/sholtomaud/boba),
vendored into `src/core/` the way Boba's own template does it.

## Running it

The host is not assumed to have Node. Everything runs in an Apple `container`
image, driven by the Makefile:

```sh
make image      # once, or after Containerfile changes
make install    # npm install, inside the container
make dev        # http://localhost:5173/Odum-basic-simulations/
make check      # typecheck + unit tests + Playwright. Must pass before pushing.
```

`make help` lists the rest. See [AGENTS.md](AGENTS.md) for the standard.

## The program archive

The listings live in [`programs/`](programs/), at the top of the repository rather
than inside the application, because they are the point of it. Each one is two
files:

```
programs/two-tank.bas     the listing
programs/two-tank.json    where it came from, and how faithfully
```

The `.json` carries a BibLaTeX-style citation and a **fidelity** — `verbatim`,
`corrected`, `adapted` or `original` — so a reader always knows whether they are
looking at the page as published or at something written to reproduce it. Both
files are published beside the app, so every program has a stable URL a citation
can point at.

**Contributions are welcome by pull request.** Add the two files and open a PR;
the build validates the metadata and CI runs the full suite against it. See
[`programs/README.md`](programs/README.md) for the format and the rules.

## Getting a chart

To get a chart, print a table: two or more numeric columns per line, the first
one the x axis, with a non-numeric line above it naming the columns.

```basic
140 PRINT "T", "Q", "OUTFLOW"
150 FOR T = 0 TO 60 STEP DT
170 PRINT T, Q, F
190 NEXT T
```

## Language support

`PRINT` (with `,` and `;`), `LET` (optional), `INPUT`, `IF`/`THEN` and `IF`…`GOTO`,
`FOR`/`TO`/`STEP`/`NEXT`, `GOTO`, `GOSUB`/`RETURN`, `DIM` (1-D and 2-D),
`DATA`/`READ`/`RESTORE`, `REM`, `END`/`STOP`, `RANDOMIZE`, and several statements per
line via `:`. **Continue** in the Output pane is `CONT`: it carries on after `END` or
`STOP`, as listings that run in stages expect.

Graphics: `SCREEN 1` (320×200, CGA palettes) and `SCREEN 2` (640×200), `COLOR`, `CLS`,
`PSET`, `PRESET`, and `LINE` with `STEP`, `B` and `BF`. The screen is drawn as the PC
showed it, and every point is also kept exactly as the program computed it.

Functions: `LEN`, `MID$`, `LEFT$`, `RIGHT$`, `STR$`, `VAL`, `CHR$`, `ASC`, `INT`,
`ABS`, `SGN`, `SQR`, `SIN`, `COS`, `TAN`, `ATN`, `EXP`, `LOG`, `RND`.

Operators: `+ - * / ^`, `= <> < > <= >=`, `AND OR NOT`, string concatenation with `+`.

**Not yet supported:** `WHILE`/`WEND`, `DEF FN`, `ON…GOTO`, `SELECT CASE`,
`PRINT USING`, `LOCATE`, `CIRCLE`, `PAINT`, `SCREEN` modes beyond 2, and `LINE` styles.
See [TODO.md](TODO.md).

## Licence

MIT.
