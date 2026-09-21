/**
 * BAS_Validate: parse, check what can be checked without running, and report
 * it in the shape Monaco reads.
 *
 * The checks here are the ones that catch a transcription error before it
 * costs a run.  A jump to a line that does not exist is the common one and the
 * worst: it is invisible until the branch is taken, which may be thousands of
 * steps in, and in a listing typed from a printed page it means a digit was
 * misread.  The others — NEXT without FOR, a duplicate line number — are the
 * mistakes that make a listing ambiguous rather than wrong, which is harder to
 * see by reading and impossible to see by running one case.
 *
 * What is deliberately not checked: anything that needs the program to run.
 * An undefined variable is not an error in this dialect (it is zero), a
 * division by zero depends on the data, and an infinite loop is a legitimate
 * program.  A validator that guesses at those produces false positives in an
 * editor, which trains the user to ignore it.
 */

#include "../include/basic.h"
#include "parser.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* --------------------------------------------------------- string building */

typedef struct {
  char *data;
  size_t len;
  size_t cap;
  int failed;
} Buf;

static void buf_append(Buf *b, const char *s) {
  if (b->failed) return;
  size_t n = strlen(s);
  if (b->len + n + 1 > b->cap) {
    size_t cap = b->cap ? b->cap : 256;
    while (cap < b->len + n + 1) cap *= 2;
    char *grown = realloc(b->data, cap);
    if (!grown) { b->failed = 1; return; }
    b->data = grown;
    b->cap = cap;
  }
  memcpy(b->data + b->len, s, n + 1);
  b->len += n;
}

static void buf_appendf(Buf *b, const char *fmt, ...) {
  char tmp[512];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(tmp, sizeof tmp, fmt, ap);
  va_end(ap);
  buf_append(b, tmp);
}

/** JSON string escaping, for a message that may hold a quote or a backslash. */
static void buf_append_json_string(Buf *b, const char *s) {
  buf_append(b, "\"");
  for (const char *p = s; *p; p++) {
    switch (*p) {
      case '"':  buf_append(b, "\\\""); break;
      case '\\': buf_append(b, "\\\\"); break;
      case '\n': buf_append(b, "\\n"); break;
      case '\r': buf_append(b, "\\r"); break;
      case '\t': buf_append(b, "\\t"); break;
      default:
        if ((unsigned char)*p < 0x20) buf_appendf(b, "\\u%04x", *p);
        else { char one[2] = {*p, '\0'}; buf_append(b, one); }
    }
  }
  buf_append(b, "\"");
}

/* -------------------------------------------------------------- diagnostics */

typedef struct {
  char message[160];
  int line, column, end_column;
  int is_unsupported;
} Diagnostic;

typedef struct {
  Diagnostic *items;
  size_t count;
  size_t cap;
} Diagnostics;

static void diag_add(Diagnostics *d, const char *msg, int line, int col,
                     int end_col, int unsupported) {
  if (d->count == d->cap) {
    size_t cap = d->cap ? d->cap * 2 : 8;
    Diagnostic *grown = realloc(d->items, cap * sizeof *grown);
    if (!grown) return;
    d->items = grown;
    d->cap = cap;
  }
  Diagnostic x;
  snprintf(x.message, sizeof x.message, "%s", msg);
  x.line = line;
  x.column = col;
  x.end_column = end_col;
  x.is_unsupported = unsupported;
  d->items[d->count++] = x;
}

/** Is `n` a line number the program defines? */
static int line_defined(BAS_Program *p, int n) {
  for (size_t i = 0; i < p->count; i++) {
    if (p->stmts[i]->line_number == n) return 1;
  }
  return 0;
}

/**
 * Jumps, and the balance of FOR and NEXT.
 *
 * The FOR check is a depth count rather than a matching of variables: a NEXT
 * may name its variable or leave it off, and `NEXT I, J` closes two loops.
 * Counting catches the two cases worth catching — a NEXT with no FOR open, and
 * a FOR still open at the end — without inventing rules the dialect does not
 * have about which NEXT closes which FOR.
 */
typedef struct { int number; int source_line; } SeenLine;

static void check_program(BAS_Program *p, Diagnostics *d, SeenLine *seen_lines,
                          size_t seen_cap, size_t *seen_count) {
  int for_depth = 0;
  BAS_Stmt *first_open_for = NULL;

  for (size_t i = 0; i < p->count; i++) {
    BAS_Stmt *s = p->stmts[i];

    /* A duplicate line number makes every jump to it ambiguous.  The unit is
       the source line, not the statement: `5 SCREEN 1,0: COLOR 0,0` is three
       statements sharing one line number, which is not a duplicate.  A second
       *source line* claiming a number already taken is. */
    if (s->line_number != 0) {
      SeenLine *seen = NULL;
      for (size_t j = 0; j < *seen_count; j++) {
        if (seen_lines[j].number == s->line_number) { seen = &seen_lines[j]; break; }
      }
      if (!seen) {
        if (*seen_count < seen_cap) {
          seen_lines[*seen_count].number = s->line_number;
          seen_lines[*seen_count].source_line = s->line;
          (*seen_count)++;
        }
      } else if (seen->source_line != s->line) {
        char msg[160];
        snprintf(msg, sizeof msg, "duplicate line number %d", s->line_number);
        diag_add(d, msg, s->line, s->column, s->end_column, 0);
        seen->source_line = s->line;   /* so a third copy reports once too */
      }
    }

    BAS_Stmt *jump = NULL;
    if (s->type == BAS_ST_GOTO || s->type == BAS_ST_GOSUB) jump = s;
    else if (s->type == BAS_ST_IF && s->has_target) jump = s;
    else if (s->type == BAS_ST_IF && s->then_branch &&
             (s->then_branch->type == BAS_ST_GOTO ||
              s->then_branch->type == BAS_ST_GOSUB)) {
      jump = s->then_branch;
    }
    if (jump && jump->has_target && !line_defined(p, jump->target)) {
      char msg[160];
      snprintf(msg, sizeof msg, "jump to undefined line %d", jump->target);
      diag_add(d, msg, jump->line, jump->column, jump->end_column, 0);
    }

    if (s->type == BAS_ST_FOR) {
      if (for_depth == 0) first_open_for = s;
      for_depth++;
    } else if (s->type == BAS_ST_NEXT) {
      if (for_depth == 0) {
        diag_add(d, "NEXT without FOR", s->line, s->column, s->end_column, 0);
      } else {
        for_depth--;
      }
    }
  }

  if (for_depth > 0 && first_open_for) {
    diag_add(d, "FOR without NEXT", first_open_for->line,
             first_open_for->column, first_open_for->end_column, 0);
  }
}

/* ------------------------------------------------------------ the entry point */

BAS_Status BAS_Validate(const char *source, char **out_json) {
  if (!out_json) return BAS_ERR_ARGUMENT;
  *out_json = NULL;
  if (!source) return BAS_ERR_ARGUMENT;

  BAS_Program prog;
  bas_parse(source, &prog);

  Diagnostics d = {0};
  for (size_t i = 0; i < prog.error_count; i++) {
    diag_add(&d, prog.errors[i].message, prog.errors[i].line,
             prog.errors[i].column, prog.errors[i].end_column,
             prog.errors[i].is_unsupported);
  }
  SeenLine *seen_lines = calloc(prog.count ? prog.count : 1, sizeof *seen_lines);
  size_t seen_count = 0;
  if (seen_lines) {
    check_program(&prog, &d, seen_lines, prog.count, &seen_count);
    free(seen_lines);
  }

  Buf b = {0};
  buf_append(&b, "{\"diagnostics\":[");
  for (size_t i = 0; i < d.count; i++) {
    Diagnostic *x = &d.items[i];
    if (i) buf_append(&b, ",");
    buf_append(&b, "{\"severity\":");
    buf_append_json_string(&b, x->is_unsupported ? "warning" : "error");
    buf_append(&b, ",\"code\":");
    buf_append_json_string(&b, x->is_unsupported ? "BAS0200" : "BAS0100");
    buf_append(&b, ",\"message\":");
    buf_append_json_string(&b, x->message);
    buf_appendf(&b,
                ",\"startLineNumber\":%d,\"startColumn\":%d"
                ",\"endLineNumber\":%d,\"endColumn\":%d}",
                x->line, x->column, x->line, x->end_column);
  }
  buf_append(&b, "]}");

  free(d.items);
  bas_program_free(&prog);

  if (b.failed) { free(b.data); return BAS_ERR_ALLOC; }
  if (!b.data) {
    b.data = malloc(1);
    if (!b.data) return BAS_ERR_ALLOC;
    b.data[0] = '\0';
  }
  *out_json = b.data;
  return BAS_OK;
}

void BAS_FreeString(char *s) { free(s); }

const char *BAS_GetErrorDescription(BAS_Status status) {
  switch (status) {
    case BAS_OK:              return "ok";
    case BAS_ERR_ALLOC:       return "out of memory";
    case BAS_ERR_ARGUMENT:    return "bad argument";
    case BAS_ERR_SYNTAX:      return "the program did not parse";
    case BAS_ERR_RUNTIME:     return "the program failed while running";
    case BAS_ERR_HALTED:      return "stopped";
    case BAS_ERR_UNSUPPORTED: return "not supported yet";
    case BAS_AWAITING_INPUT:  return "waiting for input";
    default:                  return "unknown status";
  }
}

const char *BAS_GetVersionString(void) { return "0.1.0"; }
