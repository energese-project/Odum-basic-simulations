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

## `PRINT` of a number: two divergences, neither of them the layout

The engine's `PRINT` is written against [`oracle/print.bas`](oracle/print.bas) and the
output PC-BASIC gives for it, recorded by `make attest` as
[`oracle/runs/print.txt`](oracle/runs/print.txt). Of its 22 lines, 20 match byte for byte:
the leading space where a positive number's sign would be, the trailing space after every
number, the absent leading zero (`.5`, not `0.5`), the 14-column print zones a comma moves
to, a trailing separator holding the line open, and a bare `PRINT` as a blank line.

Two lines differ, and neither is the layout.

### PC-BASIC rounds the last printed digit up, and we do not

- **What.** `PRINT 1/3` gives `.3333334` in PC-BASIC and `.3333333` here.
- **Which is right.** Ours. The single nearest a third is 0.33333334326…, whose seventh
  significant digit is correctly rounded down. PC-BASIC's conversion of a single to text is
  not correctly rounded, and the attestation already measures how often: one unit high in
  `\oraclePrintRoundedUp` of `\oraclePrintValues` values across Table 3's run
  (`compare.ts`, the `printRounding` block).
- **What it moves.** The last printed digit, and nothing else. It is why the oracle
  comparison reads PC-BASIC's printed rows with a tolerance rather than digit for digit,
  as [`oracle/RESULTS.md`](oracle/RESULTS.md) sets out.

### A literal of more than seven digits is a double on the PC, and a single here

- **What.** `PRINT 123456789` gives `123456789` in PC-BASIC and `1.234568E+08` here.
- **Why.** GW-BASIC promotes a numeric literal that will not fit in single precision to
  double, so that line never involved a single at all. This engine has one numeric type,
  `float`, so the literal is rounded on the way in and printed as what it became.
- **What it moves.** Nothing in the archive: Odum's listings hold coefficients and state
  variables, not nine-digit constants. It would matter for a listing that used `DEFDBL` or
  a `#` suffix, which is the same gap as the type-declaration work in TODO 0.2.
