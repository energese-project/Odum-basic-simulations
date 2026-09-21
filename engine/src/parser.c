/**
 * The parser.  See parser.h for why it is a stage of its own.
 *
 * Precedence follows GW-BASIC: ^ binds tightest, then unary minus, then * and
 * /, then + and -, then the comparisons, then NOT, AND, OR.  Comparisons are
 * non-associative in practice but parsed left-associatively, which is what the
 * original did and what `IF A < B < C` therefore means.
 */

#include "parser.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* basic-language.ts PLANNED: highlighted, not executed.  Kept in step by hand;
   test_validate.c checks the distinction these produce. */
static const char *const PLANNED[] = {
  "WHILE", "WEND", "DO", "LOOP", "UNTIL", "SELECT", "CASE", "ELSE",
  "DEF", "FN", "ON", "LOCATE", "USING", "TIMER", "CIRCLE", "PAINT",
  "VIEW", "WINDOW", NULL
};

static const char *const BUILTINS[] = {
  "LEN", "MID$", "LEFT$", "RIGHT$", "STR$", "CHR$", "VAL", "ASC",
  "INT", "ABS", "SGN", "SQR", "SIN", "COS", "TAN", "ATN", "EXP", "LOG",
  "RND", NULL
};

static int in_list(const char *const *list, const char *word) {
  for (size_t i = 0; list[i]; i++) {
    if (strcmp(list[i], word) == 0) return 1;
  }
  return 0;
}

int bas_is_planned(const char *word) { return in_list(PLANNED, word); }
int bas_is_builtin(const char *word) { return in_list(BUILTINS, word); }

/* ------------------------------------------------------------------ storage */

void bas_program_error(BAS_Program *p, const char *msg, int line, int column,
                       int end_column, int is_unsupported) {
  if (p->error_count == p->error_capacity) {
    size_t cap = p->error_capacity ? p->error_capacity * 2 : 8;
    BAS_ParseError *grown = realloc(p->errors, cap * sizeof *grown);
    if (!grown) return;
    p->errors = grown;
    p->error_capacity = cap;
  }
  BAS_ParseError e;
  snprintf(e.message, sizeof e.message, "%s", msg);
  e.line = line;
  e.column = column;
  e.end_column = end_column;
  e.is_unsupported = is_unsupported;
  p->errors[p->error_count++] = e;
}

static BAS_Expr *expr_new(BAS_ExprType type) {
  BAS_Expr *e = calloc(1, sizeof *e);
  if (e) e->type = type;
  return e;
}

static void expr_free(BAS_Expr *e) {
  if (!e) return;
  expr_free(e->left);
  expr_free(e->right);
  for (size_t i = 0; i < e->arg_count; i++) expr_free(e->args[i]);
  free(e->args);
  free(e);
}

static void stmt_free(BAS_Stmt *s) {
  if (!s) return;
  for (size_t i = 0; i < s->e_count; i++) expr_free(s->e[i]);
  for (size_t i = 0; i < s->subscript_count; i++) expr_free(s->subscripts[i]);
  free(s->subscripts);
  stmt_free(s->then_branch);
  free(s);
}

void bas_program_free(BAS_Program *p) {
  if (!p) return;
  for (size_t i = 0; i < p->count; i++) stmt_free(p->stmts[i]);
  free(p->stmts);
  free(p->errors);
  memset(p, 0, sizeof *p);
}

static int push_stmt(BAS_Program *p, BAS_Stmt *s) {
  if (p->count == p->capacity) {
    size_t cap = p->capacity ? p->capacity * 2 : 64;
    BAS_Stmt **grown = realloc(p->stmts, cap * sizeof *grown);
    if (!grown) return 0;
    p->stmts = grown;
    p->capacity = cap;
  }
  p->stmts[p->count++] = s;
  return 1;
}

/* ------------------------------------------------------------------- parser */

typedef struct {
  BAS_TokenList *toks;
  size_t pos;
  BAS_Program *prog;
  int line_number;   /**< The listing line currently being parsed. */
  int panicked;      /**< Suppress cascading errors until the next line. */
} Parser;

static BAS_Token *cur(Parser *p) { return &p->toks->tokens[p->pos]; }

static BAS_Token *next(Parser *p) {
  BAS_Token *t = &p->toks->tokens[p->pos];
  if (t->type != BAS_TOK_EOF) p->pos++;
  return t;
}

static int check(Parser *p, BAS_TokenType type) { return cur(p)->type == type; }

static int match(Parser *p, BAS_TokenType type) {
  if (!check(p, type)) return 0;
  next(p);
  return 1;
}

static int match_kw(Parser *p, BAS_Keyword kw) {
  if (cur(p)->type != BAS_TOK_KEYWORD || cur(p)->keyword != kw) return 0;
  next(p);
  return 1;
}

static void error_at(Parser *p, BAS_Token *t, const char *msg) {
  if (p->panicked) return;
  p->panicked = 1;
  bas_program_error(p->prog, msg, t->line, t->column, t->end_column, 0);
}

static void expect(Parser *p, BAS_TokenType type, const char *msg) {
  if (!match(p, type)) error_at(p, cur(p), msg);
}

static BAS_Expr *parse_expr(Parser *p);

static BAS_Expr *parse_primary(Parser *p) {
  BAS_Token *t = cur(p);

  if (t->type == BAS_TOK_NUMBER) {
    next(p);
    BAS_Expr *e = expr_new(BAS_EXPR_NUMBER);
    if (!e) return NULL;
    e->number = t->number;
    e->line = t->line; e->column = t->column; e->end_column = t->end_column;
    return e;
  }
  if (t->type == BAS_TOK_STRING) {
    next(p);
    BAS_Expr *e = expr_new(BAS_EXPR_STRING);
    if (!e) return NULL;
    memcpy(e->name, t->text, sizeof e->name);
    e->line = t->line; e->column = t->column; e->end_column = t->end_column;
    return e;
  }
  if (t->type == BAS_TOK_LPAREN) {
    next(p);
    BAS_Expr *inner = parse_expr(p);
    expect(p, BAS_TOK_RPAREN, "expected ')'");
    return inner;
  }
  if (t->type == BAS_TOK_MINUS || t->type == BAS_TOK_PLUS) {
    next(p);
    BAS_Expr *e = expr_new(BAS_EXPR_UNARY);
    if (!e) return NULL;
    e->op = t->type;
    e->line = t->line; e->column = t->column; e->end_column = t->end_column;
    e->left = parse_primary(p);
    return e;
  }
  if (t->type == BAS_TOK_KEYWORD && t->keyword == BAS_KW_NOT) {
    next(p);
    BAS_Expr *e = expr_new(BAS_EXPR_UNARY);
    if (!e) return NULL;
    e->op_kw = BAS_KW_NOT;
    e->line = t->line; e->column = t->column; e->end_column = t->end_column;
    e->left = parse_primary(p);
    return e;
  }
  if (t->type == BAS_TOK_IDENT) {
    next(p);
    int is_call = bas_is_builtin(t->text);
    BAS_Expr *e = expr_new(is_call ? BAS_EXPR_CALL : BAS_EXPR_VAR);
    if (!e) return NULL;
    memcpy(e->name, t->text, sizeof e->name);
    e->line = t->line; e->column = t->column; e->end_column = t->end_column;
    /* Both a call's arguments and an array's subscripts are parenthesised and
       comma-separated; which one this is depends on the name, not the shape. */
    if (check(p, BAS_TOK_LPAREN)) {
      next(p);
      size_t cap = 4;
      e->args = malloc(cap * sizeof *e->args);
      if (!e->args) return e;
      do {
        if (e->arg_count == cap) {
          cap *= 2;
          BAS_Expr **grown = realloc(e->args, cap * sizeof *grown);
          if (!grown) break;
          e->args = grown;
        }
        e->args[e->arg_count++] = parse_expr(p);
      } while (match(p, BAS_TOK_COMMA));
      expect(p, BAS_TOK_RPAREN, "expected ')'");
    }
    return e;
  }

  error_at(p, t, "expected a value");
  next(p);
  return NULL;
}

static BAS_Expr *binary(BAS_Expr *l, BAS_Token *op, BAS_Expr *r) {
  BAS_Expr *e = expr_new(BAS_EXPR_BINARY);
  if (!e) return NULL;
  e->op = op->type;
  e->op_kw = op->keyword;
  e->left = l;
  e->right = r;
  e->line = op->line; e->column = op->column; e->end_column = op->end_column;
  return e;
}

static BAS_Expr *parse_power(Parser *p) {
  BAS_Expr *l = parse_primary(p);
  while (check(p, BAS_TOK_CARET)) {
    BAS_Token *op = next(p);
    l = binary(l, op, parse_primary(p));
  }
  return l;
}

static BAS_Expr *parse_term(Parser *p) {
  BAS_Expr *l = parse_power(p);
  while (check(p, BAS_TOK_STAR) || check(p, BAS_TOK_SLASH)) {
    BAS_Token *op = next(p);
    l = binary(l, op, parse_power(p));
  }
  return l;
}

static BAS_Expr *parse_sum(Parser *p) {
  BAS_Expr *l = parse_term(p);
  while (check(p, BAS_TOK_PLUS) || check(p, BAS_TOK_MINUS)) {
    BAS_Token *op = next(p);
    l = binary(l, op, parse_term(p));
  }
  return l;
}

static int is_comparison(BAS_TokenType t) {
  return t == BAS_TOK_EQ || t == BAS_TOK_LT || t == BAS_TOK_GT ||
         t == BAS_TOK_LE || t == BAS_TOK_GE || t == BAS_TOK_NE;
}

static BAS_Expr *parse_comparison(Parser *p) {
  BAS_Expr *l = parse_sum(p);
  while (is_comparison(cur(p)->type)) {
    BAS_Token *op = next(p);
    l = binary(l, op, parse_sum(p));
  }
  return l;
}

static BAS_Expr *parse_and(Parser *p) {
  BAS_Expr *l = parse_comparison(p);
  while (cur(p)->type == BAS_TOK_KEYWORD && cur(p)->keyword == BAS_KW_AND) {
    BAS_Token *op = next(p);
    l = binary(l, op, parse_comparison(p));
  }
  return l;
}

static BAS_Expr *parse_expr(Parser *p) {
  BAS_Expr *l = parse_and(p);
  while (cur(p)->type == BAS_TOK_KEYWORD && cur(p)->keyword == BAS_KW_OR) {
    BAS_Token *op = next(p);
    l = binary(l, op, parse_and(p));
  }
  return l;
}

/* --------------------------------------------------------------- statements */

static BAS_Stmt *stmt_new(Parser *p, BAS_StmtType type) {
  BAS_Stmt *s = calloc(1, sizeof *s);
  if (!s) return NULL;
  s->type = type;
  s->line_number = p->line_number;
  s->line = cur(p)->line;
  s->column = cur(p)->column;
  s->end_column = cur(p)->end_column;
  return s;
}

static void add_expr(BAS_Stmt *s, BAS_Expr *e) {
  if (s->e_count < BAS_MAX_STMT_EXPR) s->e[s->e_count++] = e;
  else expr_free(e);
}

/** `(x, y)` — the coordinate pair PSET, PRESET and LINE are written with. */
static void parse_point(Parser *p, BAS_Stmt *s) {
  expect(p, BAS_TOK_LPAREN, "expected '(' before a coordinate");
  add_expr(s, parse_expr(p));
  expect(p, BAS_TOK_COMMA, "expected ',' between coordinates");
  add_expr(s, parse_expr(p));
  expect(p, BAS_TOK_RPAREN, "expected ')' after a coordinate");
}

static BAS_Stmt *parse_statement(Parser *p);

static BAS_Stmt *parse_keyword_statement(Parser *p, BAS_Token *kw) {
  switch (kw->keyword) {
    case BAS_KW_END: { next(p); return stmt_new(p, BAS_ST_END); }
    case BAS_KW_STOP: { next(p); return stmt_new(p, BAS_ST_STOP); }
    case BAS_KW_CLS: { next(p); return stmt_new(p, BAS_ST_CLS); }
    case BAS_KW_RETURN: { next(p); return stmt_new(p, BAS_ST_RETURN); }
    case BAS_KW_RANDOMIZE: {
      BAS_Stmt *s = stmt_new(p, BAS_ST_RANDOMIZE);
      next(p);
      if (!check(p, BAS_TOK_EOL) && !check(p, BAS_TOK_COLON) &&
          !check(p, BAS_TOK_EOF)) {
        add_expr(s, parse_expr(p));
      }
      return s;
    }
    case BAS_KW_GOTO:
    case BAS_KW_GOSUB: {
      BAS_Stmt *s = stmt_new(p, kw->keyword == BAS_KW_GOTO ? BAS_ST_GOTO
                                                           : BAS_ST_GOSUB);
      next(p);
      if (check(p, BAS_TOK_NUMBER)) {
        s->target = (int)cur(p)->number;
        s->has_target = 1;
        s->end_column = cur(p)->end_column;
        next(p);
      } else {
        error_at(p, cur(p), "expected a line number");
      }
      return s;
    }
    case BAS_KW_PRINT: {
      BAS_Stmt *s = stmt_new(p, BAS_ST_PRINT);
      next(p);
      while (!check(p, BAS_TOK_EOL) && !check(p, BAS_TOK_COLON) &&
             !check(p, BAS_TOK_EOF)) {
        if (check(p, BAS_TOK_SEMICOLON) || check(p, BAS_TOK_COMMA)) {
          /* Kept, not skipped: a comma moves to the next print zone and a
             semicolon does not, and a separator at the end of the statement
             holds the line open for the next PRINT. */
          char c = check(p, BAS_TOK_COMMA) ? ',' : ';';
          next(p);
          if (s->e_count > 0) s->sep[s->e_count - 1] = c;
          s->trailing_sep = 1;
          continue;
        }
        add_expr(s, parse_expr(p));
        s->trailing_sep = 0;
        if (p->panicked) break;
      }
      return s;
    }
    case BAS_KW_IF: {
      BAS_Stmt *s = stmt_new(p, BAS_ST_IF);
      next(p);
      add_expr(s, parse_expr(p));
      /* `THEN <line>`, `THEN <statement>`, and the bare `GOTO <line>` that
         table3.bas line 400 uses, are all the same statement. */
      if (match_kw(p, BAS_KW_THEN)) {
        if (check(p, BAS_TOK_NUMBER)) {
          s->target = (int)cur(p)->number;
          s->has_target = 1;
          next(p);
        } else {
          s->then_branch = parse_statement(p);
        }
      } else if (cur(p)->type == BAS_TOK_KEYWORD &&
                 cur(p)->keyword == BAS_KW_GOTO) {
        s->then_branch = parse_statement(p);
      } else {
        error_at(p, cur(p), "expected THEN or GOTO");
      }
      return s;
    }
    case BAS_KW_FOR: {
      BAS_Stmt *s = stmt_new(p, BAS_ST_FOR);
      next(p);
      if (check(p, BAS_TOK_IDENT)) {
        memcpy(s->name, cur(p)->text, sizeof s->name);
        next(p);
      } else {
        error_at(p, cur(p), "expected a loop variable");
      }
      expect(p, BAS_TOK_EQ, "expected '=' in FOR");
      add_expr(s, parse_expr(p));
      if (!match_kw(p, BAS_KW_TO)) error_at(p, cur(p), "expected TO");
      add_expr(s, parse_expr(p));
      if (match_kw(p, BAS_KW_STEP)) add_expr(s, parse_expr(p));
      return s;
    }
    case BAS_KW_NEXT: {
      BAS_Stmt *s = stmt_new(p, BAS_ST_NEXT);
      next(p);
      if (check(p, BAS_TOK_IDENT)) {
        memcpy(s->name, cur(p)->text, sizeof s->name);
        s->end_column = cur(p)->end_column;
        next(p);
      }
      return s;
    }
    case BAS_KW_SCREEN:
    case BAS_KW_COLOR: {
      BAS_Stmt *s = stmt_new(p, kw->keyword == BAS_KW_SCREEN ? BAS_ST_SCREEN
                                                             : BAS_ST_COLOR);
      next(p);
      do {
        if (check(p, BAS_TOK_EOL) || check(p, BAS_TOK_COLON) ||
            check(p, BAS_TOK_EOF)) break;
        add_expr(s, parse_expr(p));
      } while (match(p, BAS_TOK_COMMA));
      return s;
    }
    case BAS_KW_PSET:
    case BAS_KW_PRESET: {
      BAS_Stmt *s = stmt_new(p, kw->keyword == BAS_KW_PSET ? BAS_ST_PSET
                                                           : BAS_ST_PRESET);
      next(p);
      parse_point(p, s);
      if (match(p, BAS_TOK_COMMA)) add_expr(s, parse_expr(p));
      return s;
    }
    case BAS_KW_LINE: {
      BAS_Stmt *s = stmt_new(p, BAS_ST_LINE);
      next(p);
      parse_point(p, s);
      expect(p, BAS_TOK_MINUS, "expected '-' between LINE's two points");
      parse_point(p, s);
      if (match(p, BAS_TOK_COMMA)) {
        if (!check(p, BAS_TOK_COMMA)) add_expr(s, parse_expr(p));
        if (match(p, BAS_TOK_COMMA) && check(p, BAS_TOK_IDENT)) {
          /* B draws the box, BF fills it.  The lexer cannot know that these
             are clauses rather than variables; the parser can. */
          if (strcmp(cur(p)->text, "B") == 0) s->box = 1;
          else if (strcmp(cur(p)->text, "BF") == 0) { s->box = 1; s->filled = 1; }
          else error_at(p, cur(p), "expected B or BF");
          next(p);
        }
      }
      return s;
    }
    case BAS_KW_LET: {
      next(p);
      return parse_statement(p);
    }
    case BAS_KW_DIM: case BAS_KW_READ: case BAS_KW_DATA:
    case BAS_KW_RESTORE: case BAS_KW_INPUT: {
      /* Named, not indexed off the keyword enum. INPUT does not sit beside the
         other four there — it is BAS_KW_INPUT, near PRINT and LET — so
         `kw->keyword - BAS_KW_DIM` underflowed as a size_t, fell past the
         bounds check, and selected map[0]: every INPUT in the archive was
         parsed as a DIM. It validated clean only because `INPUT G` is shaped
         like a DIM, and `INPUT "YOUR GUESS"; G` did not, which is how it
         surfaced. A table indexed by enum order is one reordering away from
         doing this again. */
      BAS_StmtType type = kw->keyword == BAS_KW_DIM       ? BAS_ST_DIM
                          : kw->keyword == BAS_KW_READ    ? BAS_ST_READ
                          : kw->keyword == BAS_KW_DATA    ? BAS_ST_DATA
                          : kw->keyword == BAS_KW_RESTORE ? BAS_ST_RESTORE
                                                          : BAS_ST_INPUT;
      BAS_Stmt *s = stmt_new(p, type);
      next(p);
      do {
        if (check(p, BAS_TOK_EOL) || check(p, BAS_TOK_COLON) ||
            check(p, BAS_TOK_EOF)) break;
        add_expr(s, parse_expr(p));
        /* INPUT separates its prompt from its variables with a semicolon —
           `INPUT "YOUR GUESS"; G`, which programs/guess.bas uses, and which
           this loop read as the end of the statement. GW-BASIC accepts a comma
           there too; the difference between them is only whether it appends
           "? ". The others in this group take commas alone, so the semicolon
           is allowed for INPUT and not for DIM, READ, DATA or RESTORE. */
      } while (match(p, BAS_TOK_COMMA) ||
               (type == BAS_ST_INPUT && match(p, BAS_TOK_SEMICOLON)));
      return s;
    }
    default:
      error_at(p, kw, "this statement cannot start here");
      next(p);
      return NULL;
  }
}

static BAS_Stmt *parse_statement(Parser *p) {
  BAS_Token *t = cur(p);

  if (t->type == BAS_TOK_REM) {
    BAS_Stmt *s = stmt_new(p, BAS_ST_REM);
    next(p);
    return s;
  }
  if (t->type == BAS_TOK_KEYWORD) return parse_keyword_statement(p, t);

  if (t->type == BAS_TOK_IDENT) {
    /* A PLANNED word is BASIC, just not implemented.  Say so, and consume the
       line, so the message is "not supported yet" and not "syntax". */
    if (bas_is_planned(t->text)) {
      BAS_Stmt *s = stmt_new(p, BAS_ST_UNSUPPORTED);
      char msg[128];
      snprintf(msg, sizeof msg, "%s is not supported yet", t->text);
      bas_program_error(p->prog, msg, t->line, t->column, t->end_column, 1);
      while (!check(p, BAS_TOK_EOL) && !check(p, BAS_TOK_EOF)) next(p);
      return s;
    }
    /* Otherwise it is an assignment: the LET is optional and usually absent. */
    BAS_Stmt *s = stmt_new(p, BAS_ST_LET);
    if (!s) return NULL;
    memcpy(s->name, t->text, sizeof s->name);
    next(p);
    if (check(p, BAS_TOK_LPAREN)) {
      next(p);
      size_t cap = 4;
      s->subscripts = malloc(cap * sizeof *s->subscripts);
      if (s->subscripts) {
        do {
          if (s->subscript_count == cap) {
            cap *= 2;
            BAS_Expr **grown = realloc(s->subscripts, cap * sizeof *grown);
            if (!grown) break;
            s->subscripts = grown;
          }
          s->subscripts[s->subscript_count++] = parse_expr(p);
        } while (match(p, BAS_TOK_COMMA));
      }
      expect(p, BAS_TOK_RPAREN, "expected ')'");
    }
    expect(p, BAS_TOK_EQ, "expected '=' in an assignment");
    add_expr(s, parse_expr(p));
    s->end_column = p->toks->tokens[p->pos > 0 ? p->pos - 1 : 0].end_column;
    return s;
  }

  error_at(p, t, "expected a statement");
  next(p);
  return NULL;
}

void bas_parse(const char *source, BAS_Program *out) {
  memset(out, 0, sizeof *out);
  if (!source) return;

  BAS_TokenList toks;
  bas_lex(source, &toks);
  for (size_t i = 0; i < toks.error_count; i++) {
    bas_program_error(out, toks.errors[i].message, toks.errors[i].line,
                      toks.errors[i].column, toks.errors[i].end_column, 0);
  }

  Parser p = {&toks, 0, out, 0, 0};

  while (cur(&p)->type != BAS_TOK_EOF) {
    if (match(&p, BAS_TOK_EOL)) { p.panicked = 0; continue; }

    if (check(&p, BAS_TOK_LINENO)) {
      p.line_number = (int)cur(&p)->number;
      next(&p);
    }

    do {
      if (check(&p, BAS_TOK_EOL) || check(&p, BAS_TOK_EOF)) break;
      BAS_Stmt *s = parse_statement(&p);
      if (s) {
        if (!push_stmt(out, s)) stmt_free(s);
      }
      if (p.panicked) {
        /* Resume at the next line rather than cascading. */
        while (!check(&p, BAS_TOK_EOL) && !check(&p, BAS_TOK_EOF)) next(&p);
        break;
      }
    } while (match(&p, BAS_TOK_COLON));
  }

  bas_tokens_free(&toks);
}
