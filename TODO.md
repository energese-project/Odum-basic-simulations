# TODO

Ordered by what unblocks the most published listings.

## 1. Graphics statements as data emitters

`SCREEN`, `CLS`, `PSET (x, y)`, `LINE (x1, y1)-(x2, y2)`, `LOCATE`, `COLOR`.

The later mini-models plot to a 320×200 screen rather than printing a table, so they
currently produce no chart at all. **Implement `PSET` and `LINE` as emitters of
`(x, y, series)` samples rather than as pixels** and the screen plot becomes a real
Chart.js series with axes, hover and a CSV export. This is the single change that
gives the graphical listings new life instead of a facsimile of a CGA screen.

`SCREEN` and `CLS` become series-lifecycle statements: `CLS` starts a new plot,
`COLOR` picks the series slot. `LINE` in its `(x1,y1)-(x2,y2),,B` box form draws
chrome, not data, and should be ignored rather than plotted.

This sits alongside the table heuristic in [`output.ts`](src/basic/output.ts), not in
place of it — plenty of listings print a table and never draw.

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

## 6. Library

More worked examples of the standard model forms, and a citation line per program
pointing at the model it implements.
