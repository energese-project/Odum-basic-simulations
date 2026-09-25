#!/bin/sh
# The engine's tests, in the pinned Linux engine image:
#
#   the C unit tests       engine/tests/test_*.c
#   the CLI tests          engine/tests/cli.sh
#   the snapshot tests     engine/tests/snapshots.sh, every listing in programs/
#
#   test.sh             run them
#   test.sh --update    run them, rewriting the snapshots
#
# In the container rather than on the host for two reasons. /usr/bin/gcc on macOS
# is Apple clang, so a native run has not tested real GCC. And the snapshots hold
# the last bits of EXP, LOG and SQR, which come from the C library: they are made
# against glibc in one pinned image, and compared against the same.
#
# Container-agnostic like build-wasm.sh: CONTAINER_BIN is the Apple `container`
# CLI here and docker in CI. The build stays in /tmp inside the container, so no
# Linux objects are left in engine/build/ for the next native link.
set -eu
cd "$(dirname "$0")"
repo=$(cd .. && pwd)
C=${CONTAINER_BIN:-container}
IMAGE=odum-basic-engine:1

$C build -f ../validation/oracle/Containerfile.engine -t $IMAGE ../validation/oracle >/dev/null 2>&1 ||
  { echo "could not build $IMAGE" >&2; exit 1; }
$C run --rm -v "$repo":/repo $IMAGE "
  set -eu
  gcc --version | head -1
  make -s -C /repo/engine BIN=/tmp/build test cli
  sh /repo/engine/tests/cli.sh /tmp/build/odum
  sh /repo/engine/tests/snapshots.sh /tmp/build/odum ${1:-}"
