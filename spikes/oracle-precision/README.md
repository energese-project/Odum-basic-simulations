# Oracle spike: does IBM PC BASIC's arithmetic change Odum's curves?

The full specification is in [TODO.md](../../TODO.md#01-oracle-spike-does-ibm-pc-basics-arithmetic-change-the-curves).
This directory is where the spike's inputs, harness and results live. It is not
published: the build reads `programs/` only.

## `table3.bas` — the input, and how far to trust it

Table 3 of Odum, H. T. (1989), "Simulation models of ecological economics developed
with energy language methods", *Simulation* 53(2), p. 74, doi:10.1177/003754978905300205.
Read from a 300 dpi render of the scan. **Not yet checked line by line against the
page** — that is step 0.3, where it becomes `programs/odum_simulation_1989/`.

Readings that were uncertain:

| Line | Printed | Read as | Why |
| --- | --- | --- | --- |
| 40 | `KS = .01` | `K5 = .01` | `S` and `5` are one glyph on the scan; line 230 uses `K5` |
| 400 | `IF T / T0 < 320 GCTO 200` | `GOTO` | `C` for `O` is a print or scan defect; `GCTO` is not a keyword |
| 49 | `K8= .01` | as printed | spacing kept |

**None of this weakens the spike.** It compares two interpreters on the same text, so a
misread coefficient changes both runs alike. It does matter for step 0.3.

## Results

**[RESULTS.md](RESULTS.md)**: the versions, the comparisons, the answers to Q1–Q5 and the
decision. In short: precision does not change Table 3's figure, but our `PSET` breaks
half-pixel ties the other way from PC-BASIC's, and that does.

## Reproducing it

```sh
make image                              # the repository's Node image, if not built
spikes/oracle-precision/run.sh          # about 1.5 minutes
```

`run.sh` builds the oracle image from [`Containerfile`](Containerfile) (PC-BASIC, GPL-3.0,
kept in its own image), derives every listing from `table3.bas`, makes every run into
`runs/`, and regenerates the three reports. Nothing it writes is edited by hand.

| File | What it is |
| --- | --- |
| [`variants.ts`](variants.ts) | derives the trace, DEFDBL, bits and screen listings from `table3.bas` |
| [`single-precision.ts`](single-precision.ts) | our interpreter as it is (R1), or rewritten into `.work/` to round with `Math.fround` (R4a, R4b). Never merged into `src/` |
| [`run-ours.ts`](run-ours.ts) | runs the trace in ours, reading `interp.vars` rather than the printed text |
| [`compare.ts`](compare.ts) → [`comparisons.md`](comparisons.md) | every pair: per variable, threshold step, pixels; and R4 against PC-BASIC's bytes |
| [`mbf.ts`](mbf.ts) | reads Microsoft Binary Format singles out of `runs/r2-bits.txt` |
| [`replay.ts`](replay.ts) → [`replay.md`](replay.md) | one step at a time from PC-BASIC's exact state: which statement parts first |
| [`screens.ts`](screens.ts) → [`screens.md`](screens.md), `screens/` | the unmodified listing, PC-BASIC's CGA memory against `src/basic/screen.ts` |

The harness is outside the root `tsconfig.json`, so CI does not typecheck it. To check
it: `npx tsc --noEmit -p spikes/oracle-precision/tsconfig.json`, in the container.
