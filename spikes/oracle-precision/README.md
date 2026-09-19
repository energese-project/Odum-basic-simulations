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
