# Spike 0.1 results: IBM PC BASIC's arithmetic does not change Table 3's curves

**Decision: precision does not change Table 3's figure** (the first branch of the rule in
[TODO.md](../../TODO.md#decision-rule)). Single precision goes into 0.2 for fidelity, not
as a blocker to 0.3.

**Something else does.** The screen comparison (the stretch goal) found that our
`PSET` rounds a coordinate exactly half-way between two pixels up, and PC-BASIC's
rounds it to even. Table 3's x is `T / T0` with `DT = .5`, so every other point is such
a tie: 111 of 64,000 pixels differ. That comes from the rasteriser, not the arithmetic,
and it does change the figure. With ties rounded to even, the two screens are identical.

## Versions

| What | Version |
| --- | --- |
| Oracle | PC-BASIC 2.0.8, `pysdl2-dll` 2.32.10, `pyserial` 3.5 ([`Containerfile`](Containerfile)) |
| Oracle base image | `python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2` (Python 3.12.13, arm64) |
| Our interpreter | `src/basic/interpreter.ts` and `src/basic/screen.ts` at `debe228` (main) |
| Node | 26.5.1, in the repository's own `odum-basic` image |
| Containers | Apple `container` CLI 1.0.0 |

## The runs

All of them are made from [`table3.bas`](table3.bas) by [`variants.ts`](variants.ts), so none
can drift from it by hand. Each row is one of the 640 steps: `T D IV N A M`.

| Run | Interpreter | Arithmetic | Listing | Raw output |
| --- | --- | --- | --- | --- |
| R1 | ours | 64-bit double | `table3-trace.bas` | [`runs/r1.txt`](runs/r1.txt) |
| R2 | PC-BASIC | single (MBF), its default | `table3-trace.bas` | [`runs/r2.txt`](runs/r2.txt) |
| R2 bits | PC-BASIC | as R2, each value's MKS$ bytes too | `table3-trace-bits.bas` | [`runs/r2-bits.txt`](runs/r2-bits.txt) |
| R3 | PC-BASIC | `1 DEFDBL A-Z`, as TODO.md specifies | `table3-trace-defdbl.bas` | [`runs/r3.txt`](runs/r3.txt) |
| R3d | PC-BASIC | `DEFDBL A-Z` and a `#` on every literal | `table3-trace-double.bas` | [`runs/r3d.txt`](runs/r3d.txt) |
| R4a | ours | `Math.fround` on assignment | `table3-trace.bas` | [`runs/r4a.txt`](runs/r4a.txt) |
| R4b | ours | `Math.fround` on assignment, literals and every `+ - * / ^` | `table3-trace.bas` | [`runs/r4b.txt`](runs/r4b.txt) |
| Screen | PC-BASIC | the unmodified listing, CGA memory saved by `BSAVE` | `table3-screen.bas` | [`runs/r2-screen.bin`](runs/r2-screen.bin) |

Two runs go beyond the spec, and both turned out to matter:

- **R3d.** Under `DEFDBL` alone, GW-BASIC still reads `.033` as a *single-precision*
  literal and widens it: `K = .033: PRINT K` prints `3.299999982118607D-02`. So R3 is double
  arithmetic on single-precision coefficients, not a double-precision run. R3d adds `#` to
  every literal and is the real double run.
- **R2 bits.** Seven printed digits can't tell a 1-ulp difference from agreement, so this
  trace also prints each value as its four MBF bytes. Its decimal rows are identical
  to R2's, character for character, so the bytes are R2's own values.

**R4 never touches `src/`.** [`single-precision.ts`](single-precision.ts) rewrites a copy of
`interpreter.ts` into `.work/` (ignored by git) at run time. Each rewrite must match exactly
once, so if the interpreter changes, the rewrite fails loudly instead of producing a variant
that silently rounds nothing.

## Comparisons

Full tables are in [`comparisons.md`](comparisons.md), [`replay.md`](replay.md) and
[`screens.md`](screens.md). All three are generated, and `run.sh` remakes everything from clean
in about 1.5 minutes.

| Pair | Largest difference, D | Largest relative difference (variable) | Threshold step | Steps lighting a different pixel (N, A, M, D) | Largest difference, unrounded px |
| --- | --- | --- | --- | --- | --- |
| R1 – R2 | 8.9e-5 | 4.0e-5 (M, near its 0.0001 clamp) | 263 / 263 | 0, 0, 0, 0 | 6.8e-5 |
| R1 – R3 | 9.6e-7 | 3.8e-6 (M) | 263 / 263 | 0, 0, 0, 0 | 2.1e-6 |
| R1 – R3d | 5.0e-14 | 3.7e-13 (M) | 263 / 263 | 0, 0, 0, 0 | 5.7e-14 |
| R2 – R3 | 9.0e-5 | 3.6e-5 (M) | 263 / 263 | 0, 0, 0, 0 | 6.9e-5 |
| R2 – R3d | 8.9e-5 | 4.0e-5 (M) | 263 / 263 | 0, 0, 0, 0 | 6.8e-5 |
| R2 – R4a | 6.2e-6 | 4.4e-5 (M) | 263 / 263 | 0, 0, 0, 0 | 6.6e-5 |
| R2 – R4b | 6.2e-6 | 2.6e-5 (M) | 263 / 263 | 0, 0, 0, 0 | 6.6e-5 |

Bit for bit against R2's MKS$ bytes:

| Run | Rows bit-identical | First difference | Largest difference, ulps (N, A, M) |
| --- | --- | --- | --- |
| R4a | 22 of 640 | step 2, M | 24, 7, 434 |
| R4b | 60 of 640 | step 5, M, 1 ulp | 24, 6, 256 |

T, D and IV are bit-identical in both. D is dominated by `IV`, and a few ulps in `N5*D*M`
disappear when D is rounded.

The screens, for the unmodified listing:

| Our side | Pixels differing, of 64,000 |
| --- | --- |
| R1, as the site draws it | 111 |
| R4b, as the site draws it | 111 |
| R1, `PSET` rounding halves to even | **0** |

Images: [`screens/r2.png`](screens/r2.png) (PC-BASIC), [`screens/r1.png`](screens/r1.png) (ours),
and [`screens/r1-diff.png`](screens/r1-diff.png), where the differences are white. They
fall where the curves are steep, which is what a half-pixel shift in x looks like.

## Answers

**Q1. Does our interpreter draw the same curves as IBM PC BASIC, at screen pixels?**
*The arithmetic, yes. The rasteriser, not yet.* In the trace, all four series light the same
pixel on all 640 steps in every pair. The largest difference is 6.8e-5 of a pixel, and no point
lies close enough to a pixel boundary for that to move it. On the screen, 111 pixels differ. The cause is
`PSET` tie-breaking, not the arithmetic: R4b gets the same 111, and rounding ties to even
before rasterising brings it to 0. PC-BASIC rounds `PSET (0.5, y)` to x = 0, `1.5` to 2, and
`2.5` to 2, and y the same way. We checked this with a separate probe listing. `screen.ts`
uses `Math.round`, and its comment already notes the PC's rule was never verified. Note that
`CINT` is different: it rounds halves away from zero (`CINT(0.5)` is 1).

**Q2. On which step does `D > 30` first hold?** Step 263, T = 131.5, in all six trace runs. D
is 29.890 at step 262 and 30.040 at step 263. Across runs, D differs by at most 9e-5,
about 440 times smaller than the distance to 30.

**Q3. If they differ, is precision the cause?** Nothing that precision changes shows in
the figure. The values do differ, single against double, by up to 3e-6 relative (4e-5 in M,
where M is held near its 0.0001 clamp). That is at most 6.8e-5 of a pixel, and on
no step did it move one. R3d agrees with R1 to 5e-14, so PC-BASIC's double arithmetic and ours agree, and
nothing but precision separates R1 from R2. There is no conformance bug in the statements
Table 3 uses: expressions, `IF … THEN`, and `IF … GOTO`.

**Q4. Does `Math.fround` close the gap, or does MBF have to be emulated?** *It narrows
the gap but can't close it bit for bit.* R4b is 14 times closer to R2 than R1 is (D: 6.2e-6
against 8.9e-5), but only 60 of 640 rows are bit-identical. R4b is also better than R4a
(60 bit-identical rows against 22), so rounding on assignment alone isn't enough.
[`replay.ts`](replay.ts) starts each step from PC-BASIC's exact state and computes one step:
466 of 639 steps end up different in at least one quantity. The first differences are 1–2 ulp
in simple statements: R on line 200, and DD, `IV - N5*D*M`, on line 210. Cancellation in the
rates (lines 220–240) then amplifies them to hundreds of ulps of a small result. The cause
is the arithmetic itself. PC-BASIC's MBF routines carry a 24-bit mantissa and an 8-bit guard
byte, drop the bits beyond the guard byte when they align exponents or form a product,
and add rounding quirks that their source describes as matching GW-BASIC. IEEE single
rounds each operation correctly, so the two part by an ulp at a time. Bit-exact agreement needs
MBF emulated, which means reading GW-BASIC's math routines (Microsoft's MIT source), not
PC-BASIC's GPL code. No figure needs it.

**Q5. Is PC-BASIC usable as the oracle for 0.2?** *Yes*, with the caveats below.

- **Headless:** `pcbasic <file> -n -q -o=<out>`. `-n` (no interface) on its own writes
  nothing a pipe can read, so `-o` is needed.
- **Deterministic:** repeated runs of the trace and the screen produced byte-identical files.
- **Pinned:** base by digest, and `pcbasic` and both of its dependencies by version.
- **Fast enough:** the 640-step trace takes 5.8 s and the screen run 3.4 s inside the container,
  plus 1–2 s to start it. The bits trace takes 42 s because of its string handling, so
  use it for diagnosis, not on every PR.
- **It can save screens.** `DEF SEG=&HB800: BSAVE "SCREEN.BIN",0,&H4000` writes CGA memory
  headless, so 0.2 can compare screens pixel for pixel, not just trace rows.
- **`-o` is the 80-column screen.** Wider output wraps, so read it as a stream of numbers,
  not as lines. The row count and the T column check the alignment.
- **PC-BASIC's `PRINT` of a single is not correctly rounded.** 288 of 3,840 printed values are
  one unit above the correctly rounded seven digits (0.7401087284 prints as `.7401088`). No
  value was off by more than that. Compare printed values with a tolerance, or compare MKS$ bytes.
- **Every printed number is followed by a space**, negative ones included (`.3333334 -2  .00001`).
  This confirms the known `PRINT` difference in 0.2. Small singles print in E notation
  (`9.885257E-02`).
- **It is an emulation too.** Agreeing with the oracle means agreeing with PC-BASIC 2.0.8.
  On a disputed bit, GW-BASIC's source has the final word.
- **GPL-3.0.** It runs only in its own image. We read its source to explain the rounding and
  copied none of it.

## What changes as a result

Recorded in [TODO.md](../../TODO.md): 0.1 is marked done, and 0.2 is re-scoped to start with
the `PSET` tie-breaking fix, since that one changes figures, followed by conformance against
the oracle image, with screens compared as screens.
