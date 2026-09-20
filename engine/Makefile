# The C engine.  Driven from the repository root's Makefile; usable directly
# here while working on it.
#
# -ffp-contract=off is not a preference.  Fusing a multiply and an add into one
# operation rounds once where the original rounded twice, which moves results in
# the last bits and would differ between the native build and wasm.  See the
# note in include/basic_config.h; the header enforces the other half of the
# contract, FLT_EVAL_METHOD, which it can check and this cannot.

CC      ?= cc
EMCC    ?= emcc
CFLAGS  ?= -std=c11 -Wall -Wextra -Wpedantic -O2 -ffp-contract=off
INCLUDE  = -Iinclude -Isrc
# macOS folds libm into libSystem and links it whether or not it is asked for;
# GNU/Linux does not, so an -lm-less build passes here and fails in CI.
LDLIBS   = -lm

SRC      = src/lexer.c src/parser.c src/validate.c src/interp.c
TESTS    = tests/test_lexer.c tests/test_validate.c tests/test_eval.c
BIN     ?= build

# The browser build. Only what BAS_Validate needs is linked: the site uses the
# engine to check a listing as it is typed, not yet to run one, and leaving
# interp.c out keeps the committed artefact to what is actually reachable. Add
# it here when execution moves to wasm, and the export list grows with it.
WASM_SRC = src/lexer.c src/parser.c src/validate.c
WASM_OUT ?= ../src/basic/engine.wasm
WASM_EXPORTS = _BAS_Validate,_BAS_FreeString,_BAS_GetVersionString,_malloc,_free

.PHONY: all test cli wasm clean

all: test

$(BIN):
	@mkdir -p $(BIN)

# One binary per test file, so a crash in one suite does not hide the others.
test: $(BIN)
	@fail=0; \
	for t in $(TESTS); do \
		name=$$(basename $$t .c); \
		$(CC) $(CFLAGS) $(INCLUDE) -o $(BIN)/$$name $$t $(SRC) $(LDLIBS) || exit 1; \
		printf '%-16s ' "$$name"; \
		$(BIN)/$$name || fail=1; \
	done; \
	exit $$fail

# The command-line tool.
cli: $(BIN)
	$(CC) $(CFLAGS) $(INCLUDE) -o $(BIN)/odum-basic src/main.c $(SRC) $(LDLIBS)

# The browser build. Run it through `make wasm` at the repository root, which
# supplies emcc from a pinned container; emcc on the host would be a different
# toolchain from the one CI checks the committed bytes against.
#
# -sSTANDALONE_WASM with --no-entry emits a .wasm and no JavaScript. That is the
# point: the only import is emscripten_notify_memory_growth, which the loader
# stubs in a line, so there is no generated glue to commit or review. The
# validation path touches no stdio, so nothing pulls in WASI.
#
# CFLAGS is passed through unchanged, -ffp-contract=off included. The contract in
# include/basic_config.h is not native-only: a wasm build that contracts, or that
# evaluates wider than float, disagrees with the CLI in the last bits, and a
# disagreement between the two builds of one engine is the worst version of it.
#
# The chmod is not tidiness. emcc writes the output executable, git records the
# executable bit, and `wasm-check` compares with `git diff`, which reports a mode
# change as a difference — so without this the check fails on a rebuild that
# produced identical bytes. A module that is only ever fetched has no use for +x
# either way.
wasm:
	$(EMCC) $(CFLAGS) $(INCLUDE) $(WASM_SRC) -o $(WASM_OUT) \
		--no-entry -sSTANDALONE_WASM -sALLOW_MEMORY_GROWTH \
		-sEXPORTED_FUNCTIONS=$(WASM_EXPORTS)
	chmod 644 $(WASM_OUT)

clean:
	rm -rf $(BIN)
