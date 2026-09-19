# TODO

Ordered by what unblocks the most published listings.

## 1. Graphics: from the screen to a plot

**Done:** `SCREEN` 1 and 2, `COLOR`, `CLS`, `PSET`, `PRESET`, `LINE` (with `STEP`, `B`,
`BF`), and `CONT`. The interpreter records each as a `DrawOp` in the program's own
coordinates, with the line that drew it, and the Plot pane shows the screen rebuilt
from that record ([`screen.ts`](src/basic/screen.ts)) — which is what Odum's published
figures are pictures of.

**Next: read series back from the record.** The plan here used to be "`COLOR` picks
the series slot". The 1989 *Simulation* listing refutes it: it plots A (line 330) and
M (line 360) both in colour 2, in different bands of the screen. What identifies a
series is the **`PSET` statement**, so group points by `line`, label each with its
y expression (`180 - N / N0`), and chart them in screen coordinates with the y axis
reversed. Converting to model units needs the inverse of each expression and is not
attempted; comparing with a digitised figure does not need it, because the figure is
in screen coordinates too, and the listing's own `LINE (0,0)-(319,180),3,B` frame gives
the corners to calibrate against.

Still missing for other listings: `LOCATE`, `PRINT` onto the graphics screen,
`CIRCLE`, `PAINT`, `VIEW`/`WINDOW`, `LINE` styles, EGA/VGA modes.

## 2. Structured control flow

`WHILE`/`WEND`, `DO`/`LOOP`/`UNTIL`, `ON…GOTO`, `ON…GOSUB`, `SELECT CASE`, `ELSE`.
QuickBASIC-era listings use these freely and they are mechanical to add.

## 3. `DEF FN`

User-defined functions. Common in the rate-equation listings, where a flow is defined
once at the top and used in several places.

## 4. `PRINT USING`

Formatted output. Matters more than it looks: a listing that uses it prints its table
through it, so the table heuristic sees formatted text and finds nothing to plot.

## 5. Interpreter correctness

- `RND` cannot be seeded, so `RANDOMIZE` is accepted and ignored. A seedable PRNG
  would make runs reproducible, at the cost of changing every existing program's
  output — decide deliberately, not by accident.
- Integer vs floating-point variable suffixes (`A%`, `A!`, `A#`) are not recognised.
- String comparison follows JavaScript's collation, not ASCII.

## 6. The archive itself

The format, validation and contributor path are done — see
[`programs/README.md`](programs/README.md). What is missing is the content:

- **Every program in the archive is currently `original`.** None is yet a
  transcription of a published listing. The first `verbatim` entry, with a real
  citation, is the milestone that makes this an archive rather than a demo.
- A `.bib` export of the whole catalog, generated from the sidecars. The field
  names are already BibLaTeX's, so this is a formatter, not a data change.
