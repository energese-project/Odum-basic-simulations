/**
 * The evaluator.
 *
 * Every numeric value is a BAS_Real — a single, as the originals were — and
 * every operation rounds to it.  See include/basic_config.h for why that is a
 * contract rather than a detail, and why the build refuses a target that
 * evaluates intermediates wider.
 *
 * Two things this deliberately does not do:
 *
 *   It does not round a plotted coordinate.  PSET's point is emitted exactly
 *   as the program computed it.  Which pixel a half-way coordinate belongs to
 *   is the rasteriser's decision, and it is the entire subject of the oracle
 *   comparison — rounding here would erase the evidence and bake in one answer.
 *
 *   It does not stop at an error it can survive.  An unassigned variable is
 *   zero, because that is what the dialect says, and a listing that relies on
 *   it is not wrong.
 */

#include "../include/basic.h"
#include "../include/basic_config.h"
#include "parser.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BAS_MAX_CALL_DEPTH 64
#define BAS_MAX_FOR_DEPTH 32

typedef struct {
  char name[BAS_MAX_IDENT + 1];
  BAS_Real value;
} Variable;

typedef struct {
  char name[BAS_MAX_IDENT + 1];
  size_t body_pc;       /**< The statement after the FOR. */
  BAS_Real limit;
  BAS_Real step;
} ForFrame;

struct BAS_Instance {
  BAS_Program prog;

  Variable *vars;
  size_t var_count, var_cap;

  double *rows;         /**< BAS_ROW_STRIDE doubles each. */
  size_t row_count, row_cap;

  size_t pc;            /**< Index into prog.stmts. */
  int halted;
  int can_continue;
  int failed;
  char error[160];
  int error_line;

  size_t call_stack[BAS_MAX_CALL_DEPTH];
  size_t call_depth;

  ForFrame for_stack[BAS_MAX_FOR_DEPTH];
  size_t for_depth;

  BAS_Real colour;      /**< The current COLOR, for a PSET that omits one. */

  /**
   * The listing line number of the statement being executed.
   *
   * There are two line numbers in this engine and they are not the same.
   * Diagnostics from BAS_Validate carry the *file* line, because Monaco
   * highlights by file position.  A runtime error carries the *listing* line,
   * because that is the number printed in the program and the one BASIC has
   * always reported an error against — "division by zero in 10" is findable
   * whether or not the listing is the third file in a folder.
   */
  int current_line;
};

/* ---------------------------------------------------------------- variables */

static Variable *var_find(BAS_Instance *in, const char *name) {
  for (size_t i = 0; i < in->var_count; i++) {
    if (strcmp(in->vars[i].name, name) == 0) return &in->vars[i];
  }
  return NULL;
}

/** Every variable exists; an unassigned one is zero.  That is the dialect. */
static Variable *var_get(BAS_Instance *in, const char *name) {
  Variable *v = var_find(in, name);
  if (v) return v;
  if (in->var_count == in->var_cap) {
    size_t cap = in->var_cap ? in->var_cap * 2 : 32;
    Variable *grown = realloc(in->vars, cap * sizeof *grown);
    if (!grown) return NULL;
    in->vars = grown;
    in->var_cap = cap;
  }
  v = &in->vars[in->var_count++];
  snprintf(v->name, sizeof v->name, "%s", name);
  v->value = 0.0f;
  return v;
}

/* ------------------------------------------------------------------- errors */

static void fail(BAS_Instance *in, int line, const char *msg) {
  if (line == 0) line = in->current_line;
  if (in->failed) return;
  in->failed = 1;
  in->error_line = line;
  snprintf(in->error, sizeof in->error, "%s", msg);
}

/* -------------------------------------------------------------- expressions */

static BAS_Real eval(BAS_Instance *in, BAS_Expr *e);

static BAS_Real eval_builtin(BAS_Instance *in, BAS_Expr *e) {
  BAS_Real a = e->arg_count > 0 ? eval(in, e->args[0]) : 0.0f;
  const char *n = e->name;

  if (!strcmp(n, "ABS")) return BAS_ROUND(fabsf(a));
  if (!strcmp(n, "SGN")) return a > 0 ? 1.0f : (a < 0 ? -1.0f : 0.0f);
  /* INT is a floor: INT(-2.5) is -3.  A cast to int would give -2. */
  if (!strcmp(n, "INT")) return BAS_ROUND(floorf(a));
  if (!strcmp(n, "SQR")) {
    if (a < 0) { fail(in, 0, "square root of a negative number"); return 0.0f; }
    return BAS_ROUND(sqrtf(a));
  }
  if (!strcmp(n, "SIN")) return BAS_ROUND(sinf(a));
  if (!strcmp(n, "COS")) return BAS_ROUND(cosf(a));
  if (!strcmp(n, "TAN")) return BAS_ROUND(tanf(a));
  if (!strcmp(n, "ATN")) return BAS_ROUND(atanf(a));
  if (!strcmp(n, "EXP")) return BAS_ROUND(expf(a));
  if (!strcmp(n, "LOG")) {
    if (a <= 0) { fail(in, 0, "logarithm of a non-positive number"); return 0.0f; }
    return BAS_ROUND(logf(a));
  }
  if (!strcmp(n, "RND")) return BAS_ROUND((BAS_Real)rand() / (BAS_Real)RAND_MAX);

  fail(in, 0, "this function is not supported yet");
  return 0.0f;
}

/** BASIC's truth: -1 is true, 0 is false, and any non-zero counts as true. */
static BAS_Real truth(int b) { return b ? -1.0f : 0.0f; }

static BAS_Real eval(BAS_Instance *in, BAS_Expr *e) {
  if (!e || in->failed) return 0.0f;

  switch (e->type) {
    case BAS_EXPR_NUMBER:
      /* The literal is narrowed here, once, exactly as the original parsed it. */
      return BAS_ROUND(e->number);

    case BAS_EXPR_STRING:
      fail(in, 0, "a string cannot be used as a number here");
      return 0.0f;

    case BAS_EXPR_VAR: {
      Variable *v = var_get(in, e->name);
      return v ? v->value : 0.0f;
    }

    case BAS_EXPR_CALL:
      return eval_builtin(in, e);

    case BAS_EXPR_UNARY: {
      BAS_Real a = eval(in, e->left);
      if (e->op_kw == BAS_KW_NOT) return BAS_ROUND(~(long)a);
      if (e->op == BAS_TOK_MINUS) return BAS_ROUND(-a);
      return a;
    }

    case BAS_EXPR_BINARY: {
      BAS_Real l = eval(in, e->left);
      BAS_Real r = eval(in, e->right);
      if (in->failed) return 0.0f;

      if (e->op_kw == BAS_KW_AND) return BAS_ROUND((long)l & (long)r);
      if (e->op_kw == BAS_KW_OR)  return BAS_ROUND((long)l | (long)r);

      switch (e->op) {
        /* Each arithmetic result is rounded to single before it is used
           again, which is what GW-BASIC did and what the oracle measures. */
        case BAS_TOK_PLUS:  return BAS_ROUND(l + r);
        case BAS_TOK_MINUS: return BAS_ROUND(l - r);
        case BAS_TOK_STAR:  return BAS_ROUND(l * r);
        case BAS_TOK_SLASH:
          if (r == 0.0f) { fail(in, 0, "division by zero"); return 0.0f; }
          return BAS_ROUND(l / r);
        case BAS_TOK_CARET: return BAS_ROUND(powf(l, r));
        case BAS_TOK_EQ:    return truth(l == r);
        case BAS_TOK_NE:    return truth(l != r);
        case BAS_TOK_LT:    return truth(l < r);
        case BAS_TOK_GT:    return truth(l > r);
        case BAS_TOK_LE:    return truth(l <= r);
        case BAS_TOK_GE:    return truth(l >= r);
        default:
          fail(in, 0, "this operator is not supported yet");
          return 0.0f;
      }
    }
  }
  return 0.0f;
}

/* --------------------------------------------------------------------- rows */

static void emit(BAS_Instance *in, BAS_RowKind kind, int line, BAS_Real x0,
                 BAS_Real y0, BAS_Real x, BAS_Real y, BAS_Real colour,
                 int box) {
  if (in->row_count == in->row_cap) {
    size_t cap = in->row_cap ? in->row_cap * 2 : 256;
    double *grown = realloc(in->rows, cap * BAS_ROW_STRIDE * sizeof *grown);
    if (!grown) { fail(in, line, "out of memory"); return; }
    in->rows = grown;
    in->row_cap = cap;
  }
  double *r = in->rows + in->row_count * BAS_ROW_STRIDE;
  r[BAS_FIELD_KIND] = (double)kind;
  r[BAS_FIELD_LINE] = (double)line;
  r[BAS_FIELD_X0] = (double)x0;
  r[BAS_FIELD_Y0] = (double)y0;
  r[BAS_FIELD_X] = (double)x;
  r[BAS_FIELD_Y] = (double)y;
  r[BAS_FIELD_COLOR] = (double)colour;
  r[BAS_FIELD_BOX] = (double)box;
  in->row_count++;
}

/* --------------------------------------------------------------- statements */

/** The statement index where listing line `n` begins, or the program's size. */
static size_t line_index(BAS_Instance *in, int n) {
  for (size_t i = 0; i < in->prog.count; i++) {
    if (in->prog.stmts[i]->line_number == n) return i;
  }
  return in->prog.count + 1;   /* out of range: caught by the caller */
}

static int jump_to(BAS_Instance *in, int line, int target) {
  size_t idx = line_index(in, target);
  if (idx > in->prog.count) {
    char msg[128];
    snprintf(msg, sizeof msg, "jump to undefined line %d", target);
    fail(in, line, msg);
    return 0;
  }
  in->pc = idx;
  return 1;
}

/** Execute one statement.  Returns 0 when the program should stop. */
static int exec_stmt(BAS_Instance *in, BAS_Stmt *s) {
  in->current_line = s->line_number;
  switch (s->type) {
    case BAS_ST_REM:
    case BAS_ST_CLS:
    case BAS_ST_SCREEN:
    case BAS_ST_RANDOMIZE:
    case BAS_ST_UNSUPPORTED:
      in->pc++;
      return 1;

    case BAS_ST_COLOR:
      /* COLOR sets the default a later PSET uses when it names none. */
      if (s->e_count > 0) in->colour = eval(in, s->e[0]);
      in->pc++;
      return 1;

    case BAS_ST_LET: {
      Variable *v = var_get(in, s->name);
      BAS_Real value = eval(in, s->e_count ? s->e[0] : NULL);
      if (v && !in->failed) v->value = value;
      in->pc++;
      return 1;
    }

    case BAS_ST_PRINT: {
      /* Printed numbers are data too: one row per numeric column, so a
         listing that prints its table is readable the same way as one that
         plots it.  Strings are transcript, not data, and are not emitted. */
      for (size_t i = 0; i < s->e_count; i++) {
        if (s->e[i] && s->e[i]->type == BAS_EXPR_STRING) continue;
        BAS_Real v = eval(in, s->e[i]);
        emit(in, BAS_ROW_PRINT, s->line_number, (BAS_Real)i, 0.0f,
             (BAS_Real)i, v, 0.0f, 0);
      }
      in->pc++;
      return 1;
    }

    case BAS_ST_PSET:
    case BAS_ST_PRESET: {
      BAS_Real x = eval(in, s->e_count > 0 ? s->e[0] : NULL);
      BAS_Real y = eval(in, s->e_count > 1 ? s->e[1] : NULL);
      BAS_Real c = s->e_count > 2 ? eval(in, s->e[2]) : in->colour;
      emit(in, s->type == BAS_ST_PSET ? BAS_ROW_PSET : BAS_ROW_PRESET,
           s->line_number, x, y, x, y, c, 0);
      in->pc++;
      return 1;
    }

    case BAS_ST_LINE: {
      BAS_Real x0 = eval(in, s->e_count > 0 ? s->e[0] : NULL);
      BAS_Real y0 = eval(in, s->e_count > 1 ? s->e[1] : NULL);
      BAS_Real x1 = eval(in, s->e_count > 2 ? s->e[2] : NULL);
      BAS_Real y1 = eval(in, s->e_count > 3 ? s->e[3] : NULL);
      BAS_Real c = s->e_count > 4 ? eval(in, s->e[4]) : in->colour;
      emit(in, BAS_ROW_LINE, s->line_number, x0, y0, x1, y1, c,
           s->box ? (s->filled ? 2 : 1) : 0);
      in->pc++;
      return 1;
    }

    case BAS_ST_GOTO:
      if (!jump_to(in, s->line_number, s->target)) return 0;
      return 1;

    case BAS_ST_GOSUB:
      if (in->call_depth >= BAS_MAX_CALL_DEPTH) {
        fail(in, s->line_number, "GOSUB nested too deeply");
        return 0;
      }
      in->call_stack[in->call_depth++] = in->pc + 1;
      if (!jump_to(in, s->line_number, s->target)) return 0;
      return 1;

    case BAS_ST_RETURN:
      if (in->call_depth == 0) {
        fail(in, s->line_number, "RETURN without GOSUB");
        return 0;
      }
      in->pc = in->call_stack[--in->call_depth];
      return 1;

    case BAS_ST_IF: {
      BAS_Real cond = eval(in, s->e_count ? s->e[0] : NULL);
      if (in->failed) return 0;
      if (cond == 0.0f) { in->pc++; return 1; }
      if (s->has_target) return jump_to(in, s->line_number, s->target);
      if (s->then_branch) return exec_stmt(in, s->then_branch);
      in->pc++;
      return 1;
    }

    case BAS_ST_FOR: {
      Variable *v = var_get(in, s->name);
      BAS_Real start = eval(in, s->e_count > 0 ? s->e[0] : NULL);
      BAS_Real limit = eval(in, s->e_count > 1 ? s->e[1] : NULL);
      BAS_Real step = s->e_count > 2 ? eval(in, s->e[2]) : 1.0f;
      if (!v || in->failed) return 0;
      if (in->for_depth >= BAS_MAX_FOR_DEPTH) {
        fail(in, s->line_number, "FOR nested too deeply");
        return 0;
      }
      v->value = start;
      ForFrame *f = &in->for_stack[in->for_depth++];
      snprintf(f->name, sizeof f->name, "%s", s->name);
      f->body_pc = in->pc + 1;
      f->limit = limit;
      f->step = step;
      /* A loop whose range is already empty runs zero times, so the body is
         skipped to just past its NEXT. */
      if ((step > 0 && start > limit) || (step < 0 && start < limit)) {
        in->for_depth--;
        size_t i = in->pc + 1;
        int depth = 0;
        while (i < in->prog.count) {
          if (in->prog.stmts[i]->type == BAS_ST_FOR) depth++;
          else if (in->prog.stmts[i]->type == BAS_ST_NEXT) {
            if (depth == 0) { i++; break; }
            depth--;
          }
          i++;
        }
        in->pc = i;
        return 1;
      }
      in->pc++;
      return 1;
    }

    case BAS_ST_NEXT: {
      if (in->for_depth == 0) {
        fail(in, s->line_number, "NEXT without FOR");
        return 0;
      }
      ForFrame *f = &in->for_stack[in->for_depth - 1];
      Variable *v = var_get(in, f->name);
      if (!v) return 0;
      v->value = BAS_ROUND(v->value + f->step);
      if ((f->step > 0 && v->value > f->limit) ||
          (f->step < 0 && v->value < f->limit)) {
        in->for_depth--;
        in->pc++;
      } else {
        in->pc = f->body_pc;
      }
      return 1;
    }

    case BAS_ST_END:
    case BAS_ST_STOP:
      /* The program counter stays on the next statement, which is what makes
         CONT able to resume. */
      in->pc++;
      in->halted = 1;
      in->can_continue = 1;
      return 0;

    case BAS_ST_DIM:
    case BAS_ST_READ:
    case BAS_ST_DATA:
    case BAS_ST_RESTORE:
    case BAS_ST_INPUT:
      fail(in, s->line_number, "this statement is not supported yet");
      return 0;
  }
  in->pc++;
  return 1;
}

/* ---------------------------------------------------------- the entry points */

BAS_Status BAS_Init(const char *source, BAS_Instance **out_inst) {
  if (!out_inst) return BAS_ERR_ARGUMENT;
  *out_inst = NULL;
  if (!source) return BAS_ERR_ARGUMENT;

  BAS_Instance *in = calloc(1, sizeof *in);
  if (!in) return BAS_ERR_ALLOC;

  bas_parse(source, &in->prog);
  if (in->prog.error_count > 0) {
    bas_program_free(&in->prog);
    free(in);
    return BAS_ERR_SYNTAX;
  }
  in->colour = 3.0f;      /* SCREEN 1's default foreground. */
  *out_inst = in;
  return BAS_OK;
}

void BAS_Free(BAS_Instance *in) {
  if (!in) return;
  bas_program_free(&in->prog);
  free(in->vars);
  free(in->rows);
  free(in);
}

void BAS_Reset(BAS_Instance *in) {
  if (!in) return;
  in->var_count = 0;
  in->row_count = 0;
  in->pc = 0;
  in->halted = in->can_continue = in->failed = 0;
  in->call_depth = in->for_depth = 0;
  in->error[0] = '\0';
  in->error_line = 0;
}

BAS_Status BAS_Step(BAS_Instance *in, size_t max_statements) {
  if (!in) return BAS_ERR_ARGUMENT;
  if (in->failed) return BAS_ERR_RUNTIME;
  if (in->halted) return BAS_ERR_HALTED;

  for (size_t n = 0; n < max_statements; n++) {
    if (in->pc >= in->prog.count) {
      in->halted = 1;
      in->can_continue = 0;
      return BAS_ERR_HALTED;
    }
    if (!exec_stmt(in, in->prog.stmts[in->pc])) {
      if (in->failed) return BAS_ERR_RUNTIME;
      return BAS_ERR_HALTED;
    }
  }
  return BAS_OK;   /* budget spent, more to do */
}

int BAS_CanContinue(BAS_Instance *in) {
  return in && in->halted && in->can_continue && !in->failed;
}

BAS_Status BAS_Continue(BAS_Instance *in) {
  if (!in) return BAS_ERR_ARGUMENT;
  if (!BAS_CanContinue(in)) return BAS_ERR_HALTED;
  in->halted = 0;
  in->can_continue = 0;
  return BAS_OK;
}

const char *BAS_GetRuntimeError(BAS_Instance *in) {
  return (in && in->failed) ? in->error : NULL;
}

int BAS_GetRuntimeErrorLine(BAS_Instance *in) {
  return (in && in->failed) ? in->error_line : 0;
}

size_t BAS_GetRowCount(BAS_Instance *in) { return in ? in->row_count : 0; }
const double *BAS_GetRows(BAS_Instance *in) { return in ? in->rows : NULL; }

static const char *const ROW_KIND_NAME[] = {"pset", "preset", "line", "print"};

BAS_Status BAS_WriteCSV(BAS_Instance *in, char **out_csv) {
  if (!in || !out_csv) return BAS_ERR_ARGUMENT;
  *out_csv = NULL;

  /* One row is comfortably under 160 characters at %.9g per field. */
  size_t cap = 64 + in->row_count * 160;
  char *buf = malloc(cap);
  if (!buf) return BAS_ERR_ALLOC;

  size_t len = (size_t)snprintf(buf, cap, "line,kind,x0,y0,x,y,color,box\n");
  for (size_t i = 0; i < in->row_count; i++) {
    const double *r = in->rows + i * BAS_ROW_STRIDE;
    int kind = (int)r[BAS_FIELD_KIND];
    const char *name = (kind >= 0 && kind <= 3) ? ROW_KIND_NAME[kind] : "?";
    static const char *const BOX_NAME[] = {"", "B", "BF"};
    int box = (int)r[BAS_FIELD_BOX];
    len += (size_t)snprintf(buf + len, cap - len,
                            "%d,%s,%.9g,%.9g,%.9g,%.9g,%d,%s\n",
                            (int)r[BAS_FIELD_LINE], name, r[BAS_FIELD_X0],
                            r[BAS_FIELD_Y0], r[BAS_FIELD_X], r[BAS_FIELD_Y],
                            (int)r[BAS_FIELD_COLOR],
                            (box >= 0 && box <= 2) ? BOX_NAME[box] : "");
    if (len + 160 > cap) {
      cap *= 2;
      char *grown = realloc(buf, cap);
      if (!grown) { free(buf); return BAS_ERR_ALLOC; }
      buf = grown;
    }
  }
  *out_csv = buf;
  return BAS_OK;
}
