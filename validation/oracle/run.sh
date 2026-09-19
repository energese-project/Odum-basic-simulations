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

# The oracle has to give the same bytes twice.
oracle table3-trace.bas .work/r2-again.txt
cmp runs/r2.txt .work/r2-again.txt
screen .work/r2-screen-again.bin
cmp runs/r2-screen.bin .work/r2-screen-again.bin
echo "PC-BASIC: a second run of the trace and of the screen is byte-identical"

echo "running ours: R1, R4a, R4b"
for run in r1 r4a r4b; do node validation/oracle/run-ours.ts $run; done
node validation/oracle/compare.ts
node validation/oracle/replay.ts
node validation/oracle/screens.ts
node validation/oracle/latex.ts
