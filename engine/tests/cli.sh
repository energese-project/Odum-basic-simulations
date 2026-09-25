#!/bin/sh
# Tests of the `odum` command line, as a reader drives it: a listing in, rows and
# an exit code out. The engine's own behaviour is tested in C beside this; what
# is tested here is what only the CLI decides — its flags and its exit codes.
#
#   tests/cli.sh <path to odum>
set -eu
ODUM=$1
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
failed=0

fail() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; failed=1; }

# Runs a listing and leaves the exit code in $code and the plotted points in $points.
run() {
  listing=$1; shift
  printf '%b' "$listing" > "$dir/p.bas"
  rm -f "$dir/p.csv"
  set +e
  "$ODUM" run "$dir/p.bas" --csv "$dir/p.csv" "$@" > "$dir/stdout" 2> "$dir/stderr"
  code=$?
  set -e
  points=$(grep -c ',pset,' "$dir/p.csv" 2>/dev/null || true)
}

expect() {  # expect <name> <what> <actual> <expected>
  [ "$3" = "$4" ] || fail "$1" "$2 was $3, expected $4"
}

# Two runs separated by END, as MACROEC is: the second is reached only by CONT.
TWO_RUNS='10 PSET (1, 1), 1\n20 END\n30 PSET (2, 2), 1\n40 END\n'

run "$TWO_RUNS"
expect "without --cont, a run stops at END" "points" "$points" 1
expect "without --cont, a run stops at END" "exit code" "$code" 0

run "$TWO_RUNS" --cont 1
expect "--cont 1 resumes after END, as typing CONT does" "points" "$points" 2
expect "--cont 1 resumes after END, as typing CONT does" "exit code" "$code" 0

# The second END is the last statement: GW-BASIC's "Can't continue". Asking for
# more resumptions than the listing has is not a failure of the program.
run "$TWO_RUNS" --cont 5
expect "--cont stops when there is nothing left to resume" "points" "$points" 2
expect "--cont stops when there is nothing left to resume" "exit code" "$code" 0
grep -q "nothing to continue" "$dir/stderr" ||
  fail "--cont stops when there is nothing left to resume" "stderr did not say so: $(cat "$dir/stderr")"

# A listing that loops back after END, as MACROEC's lines 452-480 do, would run
# for ever under an unbounded CONT. The count is what bounds it.
LOOPS='10 X = 0\n20 PSET (X, 0), 1\n30 END\n40 X = X + 1\n50 GOTO 20\n'
run "$LOOPS" --cont 2
expect "--cont N resumes exactly N times" "points" "$points" 3
expect "--cont N resumes exactly N times" "exit code" "$code" 0

# STOP leaves the program resumable exactly as END does.
run '10 PSET (1, 1), 1\n20 STOP\n30 PSET (2, 2), 1\n' --cont 1
expect "--cont resumes after STOP" "points" "$points" 2

# A count is required and must be a whole number: a bare --cont would swallow
# the file name after it, and a negative count means nothing.
for bad in "--cont" "--cont x" "--cont -1" "--cont 1.5"; do
  # shellcheck disable=SC2086
  run "$TWO_RUNS" $bad
  expect "odum run ... $bad is a usage error" "exit code" "$code" 3
done

if [ "$failed" -ne 0 ]; then exit 1; fi
echo "cli              ok"
