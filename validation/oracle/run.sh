#!/bin/sh
# Regenerates everything the attestation records: builds the oracle image, derives
# the listings from table3.bas, makes every run, and writes the reports and
# oracle.tex. attest.sh calls this and then checks the result; run it directly
# only to look at what a change does.
#
# Needs the Apple `container` CLI, like everything else in this repository.
set -eu
cd "$(dirname "$0")"
spike=$(pwd)
repo=$(cd ../.. && pwd)
C=${CONTAINER_BIN:-container}
ORACLE=odum-pcbasic:2.0.8
ENGINE=odum-basic-engine:1
# Node pinned by digest, like the oracle: the PNGs are deflated by the zlib inside
# it, and a different build could compress the same pixels to different bytes.
NODE=node:26.5.1-slim@sha256:deae974a69e140f44f434ab29cb519fb5f8fe250fd364b8ca446bd0761acdc6a

node() { $C run --rm --init -m 2g -v "$repo":/app -w /app $NODE node "$@"; }
# -n: no interface, a filter. -q: quit when the program ends. -o: the screen's
# text, to a file. Without -o, -n writes nothing a pipe can read.
oracle() {
  $C run --rm -v "$spike":/work $ORACLE "$1" -n -q -o=/work/"$2" >/dev/null 2>&1
  test -s "$2" || { echo "PC-BASIC wrote nothing for $1" >&2; exit 1; }
}
# MACROEC (Table 2), the archived listing itself, mounted read-only: nothing is
# added to it. What a reader typed at the Ok prompt goes in on stdin instead — a
# BSAVE of the first run's screen, CONT for the second run, a BSAVE of both — and
# PC-BASIC writes the two screens into the working directory.
#
# In SCREEN 1 the prompt prints onto the same bitmap as the plot, so how it is
# typed matters. VIEW PRINT 24 TO 24 keeps every later line of text in the row
# below the plot's frame (y 184-191; the frame ends at 180). And no command is
# 40 characters or longer: a typed line that wraps makes GW-BASIC's screen
# editor insert a row, which pushes the whole plot down 8 pixels.
MACROEC="$repo/programs/odum_simulation_1989/macroeconomics"
macroec() {
  printf '%s\r\n' 'VIEW PRINT 24 TO 24' 'DEF SEG=&HB800' 'BSAVE "RUN1.BIN",0,&H4000' \
    'CONT' 'BSAVE "RUN2.BIN",0,&H4000' 'SYSTEM' |
    $C run -i --rm -v "$spike":/work -v "$MACROEC":/listing:ro $ORACLE /listing/model.bas -n >/dev/null 2>&1
  test -s RUN1.BIN && test -s RUN2.BIN || { echo "PC-BASIC saved no MACROEC screens" >&2; exit 1; }
  mv RUN1.BIN "$1-run1.bin"
  mv RUN2.BIN "$1-run2.bin"
}
# The unmodified listing prints nothing; its last line BSAVEs the CGA screen into
# this directory as SCREEN.BIN.
screen() {
  $C run --rm -v "$spike":/work $ORACLE table3-screen.bas -n -q >/dev/null 2>&1
  test -s SCREEN.BIN || { echo "PC-BASIC saved no screen" >&2; exit 1; }
  mv SCREEN.BIN "$1"
}

echo "building the oracle image ($ORACLE)"
$C build -f Containerfile -t $ORACLE . >/dev/null 2>&1
node validation/oracle/variants.ts
mkdir -p runs .work

echo "running PC-BASIC: R2, R3, R3d, R2 bits (the slow one), the screen, the rounding probe"
oracle table3-trace.bas runs/r2.txt
oracle table3-trace-defdbl.bas runs/r3.txt
oracle table3-trace-double.bas runs/r3d.txt
oracle table3-trace-bits.bas runs/r2-bits.txt
screen runs/r2-screen.bin
oracle rounding.bas runs/rounding.txt
# How GW-BASIC lays out PRINT: the sign and trailing space of a number, the
# absence of a leading zero, where a comma moves to, and when an exponent
# appears. The engine's own PRINT is written against this rather than against
# a recollection of it, and print.bas runs unaltered in both.
oracle print.bas runs/print.txt
echo "running PC-BASIC: MACROEC, typing CONT at the Ok prompt"
macroec runs/macroec

# The oracle has to give the same bytes twice.
oracle table3-trace.bas .work/r2-again.txt
cmp runs/r2.txt .work/r2-again.txt
screen .work/r2-screen-again.bin
cmp runs/r2-screen.bin .work/r2-screen-again.bin
macroec .work/macroec-again
cmp runs/macroec-run1.bin .work/macroec-again-run1.bin
cmp runs/macroec-run2.bin .work/macroec-again-run2.bin
echo "PC-BASIC: a second run of the trace and of the screen is byte-identical"

# R5: the C engine. Built and run in its own image, writing only the CSV back —
# the build stays inside the container so it cannot leave Linux objects in
# engine/build/ for the next native link to pick up.
echo "building the C engine image ($ENGINE)"
$C build -f Containerfile.engine -t $ENGINE . >/dev/null 2>&1
echo "running ours: R5, the C engine"
$C run --rm -v "$repo":/repo $ENGINE \
  'set -eu
   gcc --version | head -1 > /repo/validation/oracle/runs/r5-toolchain.txt
   make -C /repo/engine BIN=/tmp/build cli >/dev/null
   /tmp/build/odum run /repo/validation/oracle/table3.bas \
     --csv /repo/validation/oracle/runs/r5.csv >/dev/null
   m=/repo/programs/odum_simulation_1989/macroeconomics/model.bas
   /tmp/build/odum run $m --csv /repo/validation/oracle/runs/macroec-r5-run1.csv >/dev/null
   /tmp/build/odum run $m --cont 1 --csv /repo/validation/oracle/runs/macroec-r5.csv >/dev/null'
test -s runs/r5.csv || { echo "the C engine wrote no rows" >&2; exit 1; }

echo "running ours: R1, R4a, R4b"
for run in r1 r4a r4b; do node validation/oracle/run-ours.ts $run; done
node validation/oracle/compare.ts
node validation/oracle/replay.ts
node validation/oracle/screens.ts
node validation/oracle/macroec.ts
node validation/oracle/latex.ts
