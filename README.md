# Odum BASIC Simulations

A browser workbench for the BASIC simulation listings in the systems-ecology
literature. Pick a program, read it, edit it, run it, and watch the column of
numbers it prints become a curve.

**[Open it →](https://energese-project.github.io/Odum-basic-simulations/)**

The interpreter is written from scratch: no CPU emulation, no ROM image, nothing
copyrighted. That is what lets the whole thing ship as a static page.

## What it is made of

| Piece | Where |
| --- | --- |
| BASIC interpreter, DOM-free | [`src/basic/interpreter.ts`](src/basic/interpreter.ts) |
| Runs off the main thread | [`src/basic/runner.worker.ts`](src/basic/runner.worker.ts), [`runner.ts`](src/basic/runner.ts) |
| Output → plottable series | [`src/basic/output.ts`](src/basic/output.ts) |
| The program library | [`src/programs/`](src/programs/) |
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

## Adding a program

Drop a `.bas` file into [`src/programs/`](src/programs/). That is the whole
procedure — the library is built from the directory by `import.meta.glob`, so
there is no manifest to keep in step.

The first two `REM` lines are the title and the one-line description shown in the
picker:

```basic
10 REM Charge And Discharge
20 REM One tank filled at a constant rate and drained in proportion to storage.
30 LET J = 100
```

To get a chart, print a table: two or more numeric columns per line, the first
one the x axis, with a non-numeric line above it naming the columns.

```basic
140 PRINT "T", "Q", "OUTFLOW"
150 FOR T = 0 TO 60 STEP DT
170 PRINT T, Q, F
190 NEXT T
```

## Language support

`PRINT` (with `,` and `;`), `LET` (optional), `INPUT`, `IF`/`THEN`, `FOR`/`TO`/`STEP`/`NEXT`,
`GOTO`, `GOSUB`/`RETURN`, `DIM` (1-D and 2-D), `DATA`/`READ`/`RESTORE`, `REM`,
`END`/`STOP`, `RANDOMIZE`, and several statements per line via `:`.

Functions: `LEN`, `MID$`, `LEFT$`, `RIGHT$`, `STR$`, `VAL`, `CHR$`, `ASC`, `INT`,
`ABS`, `SGN`, `SQR`, `SIN`, `COS`, `TAN`, `ATN`, `EXP`, `LOG`, `RND`.

Operators: `+ - * / ^`, `= <> < > <= >=`, `AND OR NOT`, string concatenation with `+`.

**Not yet supported**, and needed before most of the graphical mini-models will
run unaltered: `SCREEN`, `CLS`, `PSET`, `LINE`, `WHILE`/`WEND`, `DEF FN`,
`ON…GOTO`, `SELECT CASE`, `PRINT USING`. See [TODO.md](TODO.md) — `PSET` and
`LINE` as data emitters rather than pixels is the piece that matters most.

## Licence

MIT.
