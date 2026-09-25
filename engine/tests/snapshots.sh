#!/bin/sh
# Snapshot tests: every listing in programs/, run through the `odum` CLI, against
# the rows and the printed text it produced when the snapshot was last accepted.
#
#   tests/snapshots.sh <path to odum>            compare
#   tests/snapshots.sh <path to odum> --update   rewrite the snapshots
#
# For each programs/<id>.bas, tests/snapshots/ holds
#   <id>.csv     the rows `odum run --csv` wrote: every PSET, LINE and PRINT row
#   <id>.out     what it printed to the console
# and optionally, when the run needs them,
#   <id>.args    extra arguments for `odum run`, e.g. `--cont 1`
#   <id>.stdin   the lines to answer INPUT with
#
# Snapshots are only meaningful from the pinned engine image (engine/test.sh):
# EXP, LOG and SQR come from the C library, and glibc and macOS's libm are not
# obliged to agree in the last bit. Run this through `make engine-test`, not
# against a native build.
set -eu
ODUM=$1
UPDATE=${2:-}
here=$(cd "$(dirname "$0")" && pwd)
programs=$(cd "$here/../../programs" && pwd)
snaps=$here/snapshots
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$snaps"
failed=0
count=0

for bas in "$programs"/*.bas; do
  id=$(basename "$bas" .bas)
  args=""
  [ -f "$snaps/$id.args" ] && args=$(cat "$snaps/$id.args")
  stdin=/dev/null
  [ -f "$snaps/$id.stdin" ] && stdin=$snaps/$id.stdin

  # A budget, so a listing that stops terminating fails here instead of hanging CI.
  # shellcheck disable=SC2086
  if ! "$ODUM" run "$bas" --csv "$work/$id.csv" --max-steps 50000000 $args \
       < "$stdin" > "$work/$id.out" 2> "$work/$id.err"; then
    printf '  FAIL  %s\n        odum run failed: %s\n' "$id" "$(cat "$work/$id.err")"
    failed=1
    continue
  fi
  count=$((count + 1))

  if [ "$UPDATE" = "--update" ]; then
    cp "$work/$id.csv" "$work/$id.out" "$snaps/"
    continue
  fi
  for kind in csv out; do
    if [ ! -f "$snaps/$id.$kind" ]; then
      printf '  FAIL  %s\n        no snapshot %s.%s; run make engine-snapshots-update and review it\n' "$id" "$id" "$kind"
      failed=1
    elif ! cmp -s "$snaps/$id.$kind" "$work/$id.$kind"; then
      printf '  FAIL  %s\n        %s.%s differs from its snapshot:\n' "$id" "$id" "$kind"
      diff -u "$snaps/$id.$kind" "$work/$id.$kind" | head -20 | sed 's/^/        /'
      failed=1
    fi
  done
done

# A snapshot whose listing has gone is a test of nothing.
for snap in "$snaps"/*.csv; do
  [ -e "$snap" ] || continue
  id=$(basename "$snap" .csv)
  if [ ! -f "$programs/$id.bas" ]; then
    printf '  FAIL  %s\n        snapshot with no programs/%s.bas\n' "$id" "$id"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then exit 1; fi
if [ "$UPDATE" = "--update" ]; then
  echo "snapshots        $count rewritten in engine/tests/snapshots/ — review the diff before committing"
else
  echo "snapshots        $count programs ok"
fi
