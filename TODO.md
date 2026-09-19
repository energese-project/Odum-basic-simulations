# TODO

Ordered by what unblocks the most published listings.

## 0. Next: reproducing Odum (1989), in this order

The goal is a published work, Odum (1989) *Simulation* 53(2), transcribed, run and
compared with its own figures. The interpreter now draws what its listings draw (#16).
Before a comparison can mean anything, we have to know that differences come from
Odum, not from us — so the order matters:

1. **0.1 Oracle spike** — does IBM PC BASIC's arithmetic change the curves? **Done:** no,
   but `PSET`'s rounding of half pixels does. See
   [`validation/oracle/RESULTS.md`](validation/oracle/RESULTS.md).
2. **0.2 Conformance tests and dialect profiles** — prove we behave like the BASIC
   each listing was written for.
3. **0.3 Transcribe the paper**, with the command-line tool and run snapshots.
4. **0.4 Ship the command-line tool** as single-executable binaries, on GitHub
   Releases and npm.

### 0.1 Oracle spike: does IBM PC BASIC's arithmetic change the curves?

**Done. Decision: precision does not change Table 3's figure** — the first branch of the
rule below. In every pair of runs, all four series light the same pixel on all 640 steps,
and `D > 30` fires on step 263 in each. Single precision goes into 0.2 for fidelity, not
as a blocker. The screen comparison found what does change the figure: PC-BASIC's `PSET`
rounds a half-pixel coordinate to even, ours rounds it up, and Table 3 is on a half pixel
every other step — 111 pixels differ, and none once ties go to even. `Math.fround` is not
bit-exact with Microsoft Binary Format (60 of 640 rows), and nothing needs it to be. PC-BASIC
works as the oracle, screens included. Evidence and the answers to Q1–Q5:
[`validation/oracle/RESULTS.md`](validation/oracle/RESULTS.md).

The specification as it was run:

**Timebox: half a day.** A spike: its product is an answer and the evidence for it,
recorded in [`validation/oracle/`](validation/oracle/). Nothing in it is
wired into CI or the site yet.

#### Why

GW-BASIC and BASICA compute in **single precision** by default: about 7 significant
digits, in Microsoft Binary Format. Our interpreter computes in JavaScript's 64-bit
doubles. Table 3 integrates for 640 Euler steps and has a threshold in it:
`285 IF D >30 THEN IV = 0`. If precision moves the step on which that fires, or
moves any curve by a pixel, then a difference between our run and Odum's figure
could be ours, and the site would blame the paper for it.

#### The questions it must answer

1. **Q1.** Does our interpreter draw the same curves as IBM PC BASIC for Table 3, at
   the resolution of the published figure — screen pixels?
2. **Q2.** On which step does `D > 30` first hold (line 285), in each? The same one?
3. **Q3.** If they differ, is precision the cause?
4. **Q4.** Does a quick single-precision emulation (`Math.fround`) close the gap, or
   do we need to emulate Microsoft Binary Format itself?
5. **Q5.** Is PC-BASIC usable as the oracle for step 0.2: headless, deterministic,
   installable in a pinned container, fast enough for CI?

#### The oracle

[PC-BASIC](https://github.com/robhagemans/pcbasic) (Rob Hagemans), an emulator of
GW-BASIC, BASICA, PCjr Cartridge BASIC and Tandy GW-BASIC, including their number
format. It runs headless (`--interface=none`) and can write screen output to a file
(`-o`). Check `pcbasic --help` in the pinned version for the exact flags, including
how to make it exit when the program ends.

- **Licence: GPL-3.0.** Install it with `pip` into a separate container image used
  only to run it. Never vendor it, bundle it or copy its code into this repository,
  the site or the command-line tool.
- **Pin the version.** An oracle that changes under us is not one.
- Microsoft's [GW-BASIC source](https://github.com/microsoft/GW-BASIC) (8088 assembly,
  MIT, 1983) is the final word on a disputed behaviour. It has no build scripts, so it
  is read, not run.

#### Input

[`validation/oracle/table3.bas`](validation/oracle/table3.bas): Table 3,
read from the scan, with its uncertain readings listed in the README beside it. A
misread coefficient changes both interpreters' runs alike, so it does not weaken the
comparison.

#### Method

1. **A container for the oracle.** `validation/oracle/Containerfile`: a pinned
   Python base and a pinned `pcbasic`. Build and run it with the Apple `container`
   CLI, like the other images. Record the exact versions in the results.
2. **A trace variant, for both interpreters.** `table3-trace.bas` = `table3.bas`
   with the graphics lines removed (4, 5, 6, 7, 310, 330, 360, 365 — they change no
   variable) and one line added before the loop test:
   `395 PRINT T; D; IV; N; A; M`. Line 395 is unused in the listing. Removing the
   graphics keeps the output plain text on both sides.
3. **Four runs**, each producing one row per step (640 rows):

   | Run | Interpreter | Arithmetic | How |
   | --- | --- | --- | --- |
   | R1 | ours | 64-bit double | the trace variant as it is |
   | R2 | PC-BASIC | single (its default) | the trace variant as it is |
   | R3 | PC-BASIC | double | `1 DEFDBL A-Z` prepended — a diagnostic, not the listing |
   | R4 | ours | single, emulated | a spike-only switch rounding with `Math.fround`: R4a on assignment only, R4b after every arithmetic operation too |

   - **Our side reads the variables, not the printed text.** Our `PRINT` rounds to
     six decimal places, and M is clamped at 0.0001. In the harness, snapshot
     `interp.vars` (public) from the `print` callback on each row, so R1 and R4 keep
     their full values.
   - **PC-BASIC's side is its printed rows.** Single precision prints about 7
     significant digits, which is its precision anyway; under `DEFDBL`, up to 16.
   - R4 is a hack on a spike branch, not a feature. Do not merge it.
4. **A comparison harness**, `compare.ts`, run with Node inside the existing image.
   For each pair of runs (R1–R2, R1–R3, R2–R3, R2–R4a, R2–R4b):
   - **per variable**, the largest absolute and relative difference over the run,
     and the step where it occurs;
   - **the threshold step**: the first T at which IV becomes 0;
   - **the pixel test, which is the one that decides.** For every step and each of the
     four series, the pixel the listing would light: x = `round(T / T0)`, and y =
     `round(180 - N / N0)`, `round(180 - A / A0)`, `round(49 - M / M0)`,
     `round(49 - D / D0)`. Count the steps where the two runs light a different pixel,
     and give the largest difference in rows. The published figure is at screen
     resolution, so a difference below a pixel cannot show in it.
5. **Stretch, only if time is left.** Can PC-BASIC save its graphics screen headless?
   If so, compare its screen for the unmodified `table3.bas` with ours pixel for
   pixel. Stop after 30 minutes. The trace already decides the question, because the
   pixels follow from the values.

#### Decision rule

- **R1 and R2 agree in every pixel, and the threshold fires on the same step:**
  precision does not change Table 3's figure. Record that, and add single precision in
  0.2 for fidelity, not as a blocker.
- **They disagree, and R3 agrees with R1:** precision is the cause, and single
  precision becomes a prerequisite to 0.3. Then:
  - **R4 agrees with R2:** `Math.fround` emulation is enough. Record whether R4a
    suffices or R4b is needed.
  - **R4 does not agree with R2:** Microsoft Binary Format has to be emulated. It has
    the same 24-bit mantissa as IEEE single, but its own exponent range, and possibly
    its own rounding in the software float routines. Scope that as its own task.
- **R3 does not agree with R1 either:** something other than precision differs. That is
  a conformance bug — a function, `IF`, or evaluation order — and is found by bisecting
  the trace to the first differing step.

#### Done when

`validation/oracle/` contains `Containerfile`, `table3-trace.bas`, the harness,
the four raw outputs, and `RESULTS.md`. The results give the versions used, a table of
the comparisons above, the answer to each of Q1–Q5, and the decision taken from the
rule. This TODO is updated with the decision, and 0.2 is re-scoped to match.

### 0.2 Conformance tests and dialect profiles

Re-scoped after 0.1, whose [results](validation/oracle/RESULTS.md) are the evidence
for each point here.

- **First: `PSET` breaks half-pixel ties to even.** PC-BASIC puts `PSET (0.5, y)` on x = 0,
  `1.5` on 2 and `2.5` on 2, and y likewise; `screen.ts` uses `Math.round`, which rounds
  up. This one changes figures, so it comes before anything else here, test first. Check
  `LINE` and box end points against the oracle as well, and GW-BASIC's source for the rule
  itself. Expect the figure goldens to move; review each. `CINT` is not the same rule — it
  rounds halves away from zero. `make attest` then fails on purpose: the screens now
  agree, and the article's oracle paragraph says they do not. Revise the paragraph and
  the claim in `validation/oracle/latex.ts`, then `make attest-update`.
- **A conformance suite in CI.** A job like `figures`, in the pinned oracle image —
  [`validation/oracle/`](validation/oracle/)'s `Containerfile`, pinned the same way. Its
  first step is to run `make attest` in CI, which nothing does yet. It runs every archive
  program — each run of each model, with its `changes` applied — in PC-BASIC and in ours,
  and compares the results. From the spike:
  - **Drawn output is compared as screens.** `DEF SEG=&HB800: BSAVE "SCREEN.BIN",0,&H4000`
    saves CGA memory headless; `screens.ts` decodes it. That is the comparison that found
    the `PSET` rule, which a trace cannot see.
  - **Printed text is compared with a tolerance**, never digit for digit: PC-BASIC's `PRINT`
    of a single is not correctly rounded (one unit high in 288 of 3,840 values), and IEEE
    single parts from MBF by ulps that accumulate. MKS$ bytes are the exact comparison, for
    diagnosis; they cost seven times the run time.
  - Run it as `pcbasic <file> -n -q -o=<out>`, and read `-o` as a stream of numbers: it is the
    80-column screen, and wide rows wrap. A run of Table 3 takes about 6 s.
  - Known, deliberate differences live in one file, each with its reason and a link to the
    evidence.
- **Single precision, for fidelity.** For `ibm-pc-basic`, IEEE single: `Math.fround` on
  every literal, every assignment and after every operation (the spike's R4b; rounding on
  assignment alone, R4a, is measurably worse). It is not bit-exact with Microsoft Binary
  Format, which keeps a guard byte and drops the bits beyond it. **Bit-exact MBF is a
  separate task**, taken on only if a listing shows a difference that can be seen, and
  written from GW-BASIC's MIT math routines — never from PC-BASIC's GPL code.
- **Dialect profiles.** A `dialect` field in every sidecar and `meta-data.json`,
  required and with no default, for the same reason as `fidelity`. Add profiles only
  for dialects an archived listing uses:
  - `ibm-pc-basic` (BASICA and GW-BASIC): PC-BASIC is its oracle.
  - `quickbasic`: the 1989 paper says its runs were "accelerated by using QUICK
    BASIC". There is no open QuickBASIC to test against; record what evidence stands
    in for one.

  A profile selects behaviour where the dialects differ: default precision, `PRINT`
  number formatting, `INT`/`CINT` rounding, the keyword set, graphics modes. Each
  difference is backed by an oracle run or a manual reference, never by memory.
- **Type declarations and suffixes** (`DEFINT`, `DEFSNG`, `DEFDBL`, `%`, `!`, `#`):
  GW-BASIC listings use them, and single precision needs them. Under `DEFDBL`, a literal
  is still single unless it has a `#`: `DEFDBL A-Z: K = .033: PRINT K` prints
  `3.299999982118607D-02` in PC-BASIC. Whether more than seven digits also makes a literal
  double is not yet checked against the oracle.
- **Known before the suite exists — confirm each against the oracle:**
  - `PRINT` of a number. GW-BASIC's manual has every printed number followed by a
    space, as well as a positive one preceded by one — **confirmed by the oracle**
    (`.3333334 -2  .00001`). Ours omits the trailing space, so `PRINT T; D` runs a
    negative D into T. The table heuristic in `output.ts` splits on whitespace and would
    read `0.5-1` as one field.
  - `PRINT` of a small single uses E notation: 0.09885257 prints as `9.885257E-02`. Ours
    prints six decimal places.
- **Fix the interpreter's header**, which calls it "BASIC V2-style". That is Commodore
  BASIC, the wrong family for Odum.

### 0.3 Transcribe Odum (1989), with the command-line tool and run snapshots

- **The work** is `programs/odum_simulation_1989/`, in the layout of #15:
  - **`macroeconomics/`**: Table 2, p. 71, and Figure 2. Runs `fig3a` (as printed)
    and `fig3b`, which is reached with `CONT` after the `END`. A run needs a way to say
    "then continue". Also decide, from the figure, whether 3b is drawn over 3a on one
    screen, as the listing implies, or on a fresh one.
  - **`state-development/`**: Table 3, p. 74, and Figure 4. Runs `fig5` to `fig9`,
    each with the `changes` its caption states. Table 4, the equations, has no place
    in the layout yet — decide whether it becomes an `equations` crop.
  - **Fidelity**: check each line against the page, including the readings in the
    spike's README. A defect in the print, like `GCTO`, is transcribed as the keyword
    it evidently is, and the note says so.
  - **`source.json`'s rights statement** is the maintainer's to write. The build
    requires a person to state it.
- **The command-line tool**, built on the same interpreter core as the site:
  - `odum-basic run <file.bas> [--run <run.json>] [--csv <out>] [--png <out>] [--trace]`
  - `odum-basic snapshot [--update]`: every run in the archive, against its committed
    snapshot.
  - `odum-basic check`: the archive's validation, as the build does it.
  - Exit codes that CI and agents can rely on.
- **Run snapshots.** Each run gets `runs/<run>.csv`: long format, one row per point,
  `line,expression,x,y,color` in draw order. It is published beside the run, so a
  reader can download the reproduction. The layout rules and `publishedFiles` must
  allow it. CI regenerates every snapshot and fails on any difference. A snapshot
  catches *us* changing; it says nothing about whether we are right — that is 0.2's
  job, and the comparison with the figure is the reproduction's.

### 0.4 Ship the command-line tool: single executables, on GitHub Releases and npm

People may not have Node, and the ones who do may have a version too old to run it.
So the tool ships as Node single executable applications, which carry their own Node.

- **Build.** Bundle the CLI entry into one JavaScript file with the existing build
  tooling. Then `node --build-sea sea-config.json` on Node 26 — see the
  [SEA documentation](https://nodejs.org/api/single-executable-applications.html).
  Check whether the SEA entry may be ESM or must be CommonJS.
- **Targets**: linux-x64, linux-arm64, darwin-arm64, darwin-x64, win32-x64. A SEA is
  built by injecting into the Node binary that runs the build, so each target is built
  on its own OS and architecture in a CI matrix, unless the documentation says Node 26
  can cross-build.
- **Two channels, because npm itself needs Node:**
  - **GitHub Releases**, for machines without Node: one binary per target, with SHA-256
    checksums.
  - **npm**, for everyone else, whatever Node they have: an `odum-basic` package whose
    `optionalDependencies` are one package per target (`os` and `cpu` set), each
    holding that target's binary — the pattern esbuild uses. The main package's `bin`
    is a small plain-JavaScript launcher, written for old Node versions, that runs the
    right binary. Decide the npm scope and who owns it.
- **Signing.** On macOS the injected binary's signature is invalidated and must at
  least be re-signed ad hoc (`codesign --sign -`). A downloaded unsigned binary still
  meets Gatekeeper, and on Windows SmartScreen. Developer ID signing and notarisation
  need an Apple developer account: the maintainer's decision, stated in the release
  notes either way.
- **Tests run on the binaries**, not only on the source: on every target, before a
  release, the built executable runs an archive program and matches its snapshot.
- **Release trigger**: a `cli-v*` tag, and the version from `package.json`.

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
