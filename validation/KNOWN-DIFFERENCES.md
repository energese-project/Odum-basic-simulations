# Known differences from the oracle

Where our interpreter deliberately does not do what PC-BASIC does. The conformance
suite (TODO.md, 0.2) compares every archive run with PC-BASIC, and a difference listed
here is expected rather than a failure. Every entry gives its reason and the evidence
for it. "PC-BASIC does it" is not a reason to copy a behaviour: PC-BASIC is an emulator,
and where it and Microsoft's published
[GW-BASIC source](https://github.com/microsoft/GW-BASIC) (MIT, 1983) disagree, the
source decides.

An entry here is about the dialect it names. Another dialect's profile may need the
opposite rule.

## `ibm-pc-basic`

### A graphics coordinate half-way between two pixels

| | 0.5 | 1.5 | 2.5 | −0.5 |
| --- | --- | --- | --- | --- |
| GW-BASIC, from its source | 1 | 2 | 3 | −1 |
| Ours ([`screen.ts`](../src/basic/screen.ts), `toPixel`) | 1 | 2 | 3 | −1 |
| PC-BASIC 2.0.8, `PSET` and `LINE` | 0 | 2 | 2 | 0 |
| PC-BASIC 2.0.8, `CINT` | 1 | 2 | 3 | −1 |

**Ours follows GW-BASIC: a half goes away from zero.**

- **GW-BASIC.** Every coordinate of `PSET`, `PRESET` and `LINE` is read by `SCAND`
  (GENGRP.ASM), which calls `GETIN2` (GWEVAL.ASM), which calls `FRCINT`. That is the
  routine `CINT` uses (MATH2.ASM, `$FI` … `CINT:`). It shifts the magnitude right and adds
  back the first bit shifted out (`ADC BX,0`), then restores the sign, so a half goes away
  from zero. `PSET` and `CINT` cannot disagree on the PC.
- **PC-BASIC.** Its graphics code converts a coordinate with Python's `int(round(x))`
  (`_get_window_physical` in `basic/display/graphics.py`), and Python's `round` goes to
  even. Its `CINT` follows GW-BASIC. [`oracle/rounding.bas`](oracle/rounding.bas) shows
  the two disagreeing inside PC-BASIC; the output is in
  [`oracle/screens.md`](oracle/screens.md), and `make attest` reruns it. We read PC-BASIC's
  source only to find the cause, and copied none of it (GPL-3.0).
- **What it moves.** Table 3 of Odum (1989): 111 of 64,000 pixels, every one of them at a
  half-pixel x. With PC-BASIC's rounding applied to our points, the screens are identical
  ([`oracle/screens.md`](oracle/screens.md), [`oracle/RESULTS.md`](oracle/RESULTS.md)).
- **How to compare.** When comparing a screen with PC-BASIC's, round our DrawOps' halves
  to even first, as `screens.ts` does for its `r1-half-even` case. A difference that
  remains is a real one.

Negative halves only matter off the screen, or where a clipped `LINE` enters it. We
rounded them towards zero until this entry was written.
