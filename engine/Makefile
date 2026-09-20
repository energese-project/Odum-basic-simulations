# The C engine.  Driven from the repository root's Makefile; usable directly
# here while working on it.
#
# -ffp-contract=off is not a preference.  Fusing a multiply and an add into one
# operation rounds once where the original rounded twice, which moves results in
# the last bits and would differ between the native build and wasm.  See the
# note in include/basic_config.h; the header enforces the other half of the
# contract, FLT_EVAL_METHOD, which it can check and this cannot.

CC      ?= cc
CFLAGS  ?= -std=c11 -Wall -Wextra -Wpedantic -O2 -ffp-contract=off
INCLUDE  = -Iinclude -Isrc

SRC      = src/lexer.c src/parser.c src/validate.c
TESTS    = tests/test_lexer.c tests/test_validate.c
BIN      = build

.PHONY: all test clean

all: test

$(BIN):
	@mkdir -p $(BIN)

# One binary per test file, so a crash in one suite does not hide the others.
test: $(BIN)
	@fail=0; \
	for t in $(TESTS); do \
		name=$$(basename $$t .c); \
		$(CC) $(CFLAGS) $(INCLUDE) -o $(BIN)/$$name $$t $(SRC) || exit 1; \
		printf '%-16s ' "$$name"; \
		./$(BIN)/$$name || fail=1; \
	done; \
	exit $$fail

clean:
	rm -rf $(BIN)
