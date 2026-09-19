#!/bin/sh
# Spike 0.1, end to end: builds the oracle image, derives the listings from
# table3.bas, makes every run, and writes comparisons.md, replay.md and
# screens.md. Needs the Apple `container` CLI and the repository's own image
# (`make image`). Takes about two minutes, most of it the bits trace.
set -eu
cd "$(dirname "$0")"
spike=$(pwd)
repo=$(cd ../.. && pwd)
C=${CONTAINER_BIN:-container}
ORACLE=odum-pcbasic:2.0.8

node() { $C run --rm --init -m 2g -v "$repo":/app odum-basic node "$@"; }
# -n: no interface, a filter. -q: quit when the program ends. -o: the screen's
# text, to a file. Without -o, -n writes nothing a pipe can read.
oracle() { $C run --rm -v "$spike":/work $ORACLE "$1" -n -q -o=/work/"$2" >/dev/null 2>&1; }

$C build -f Containerfile -t $ORACLE . >/dev/null
node spikes/oracle-precision/variants.ts
mkdir -p runs .work

start=$(date +%s)
oracle table3-trace.bas runs/r2.txt
echo "r2: $(wc -l < runs/r2.txt | tr -d ' ') rows in $(( $(date +%s) - start ))s, container start included"
oracle table3-trace-defdbl.bas runs/r3.txt
oracle table3-trace-double.bas runs/r3d.txt
oracle table3-trace-bits.bas runs/r2-bits.txt
# The unmodified listing; its last line BSAVEs the CGA screen into the spike directory.
oracle table3-screen.bas .work/screen.txt
mv SCREEN.BIN runs/r2-screen.bin

# Q5: the oracle has to give the same bytes twice.
oracle table3-trace.bas .work/r2-again.txt
cmp runs/r2.txt .work/r2-again.txt && echo "r2: a second run is byte-identical"
oracle table3-screen.bas .work/screen.txt
cmp runs/r2-screen.bin SCREEN.BIN && echo "r2-screen: a second run is byte-identical"
rm SCREEN.BIN

for run in r1 r4a r4b; do node spikes/oracle-precision/run-ours.ts $run; done
node spikes/oracle-precision/compare.ts >/dev/null
node spikes/oracle-precision/replay.ts >/dev/null
node spikes/oracle-precision/screens.ts >/dev/null
echo "wrote comparisons.md, replay.md, screens.md and screens/"
