#!/bin/sh
# Builds src/basic/engine.wasm from engine/, in the pinned emscripten image.
#
#   build-wasm.sh           rebuild the committed artefact
#   build-wasm.sh --check   rebuild it, then fail if a byte moved
#
# The artefact is committed because Pages deploys with `npm ci && npm run build`
# on a runner that has Node and nothing else. --check is what stops a committed
# binary from quietly ceasing to follow from its source.
#
# Container-agnostic on purpose: everything goes through CONTAINER_BIN, so the
# Apple `container` CLI drives it here and docker drives it in CI. The Makefile
# target cannot be reused there, because it depends on `make start`, which runs
# `container system start` — a command docker does not have.
set -eu
cd "$(dirname "$0")"
repo=$(cd .. && pwd)
C=${CONTAINER_BIN:-container}
IMAGE=odum-basic-wasm:1

$C build -f Containerfile.wasm -t $IMAGE .
# The version is printed rather than assumed: the pin is an image digest, and
# this is what says which emcc that digest actually carries.
$C run --rm -v "$repo":/repo $IMAGE \
  'emcc --version | head -1 && make -C /repo/engine wasm'

if [ "${1:-}" = "--check" ]; then
  if git -C "$repo" diff --quiet -- src/basic/engine.wasm; then
    echo "engine.wasm is the bytes the source produces."
  else
    echo "engine.wasm does not match engine/. Run 'make wasm' and commit it." >&2
    git -C "$repo" diff --stat -- src/basic/engine.wasm
    exit 1
  fi
fi
