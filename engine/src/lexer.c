/**
 * The lexer.  See lexer.h for why it is separable from the rest of the engine.
 *
 * Three things in this dialect are not what a general BASIC lexer assumes, and
 * each has broken an implementation of this archive before:
 *
 *   - The number opening a line is structure, not a value.  `400 IF T < 320
 *     GOTO 200` has three numbers in it and only one of them is a line number.
 *   - REM runs to the end of the line, colons included.  A prose comment
 *     chopped at its first colon leaves the remainder to be executed.
 *   - `1E-3` is one number.  Tokenising the E as a variable silently turns a
 *     rate coefficient into zero, which is a wrong answer rather than an error.
 */

#include "lexer.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *const KEYWORD_NAMES[BAS_KW_COUNT] = {
  "", "PRINT", "LET", "INPUT", "IF", "THEN",
  "FOR", "TO", "STEP", "NEXT",
  "GOTO", "GOSUB", "RETURN",
  "DIM", "READ", "DATA", "RESTORE",
  "END", "STOP", "RANDOMIZE",
  "AND", "OR", "NOT",
  "SCREEN", "COLOR", "CLS",
  "PSET", "PRESET", "LINE"
};

const char *bas_keyword_name(BAS_Keyword kw) {
  return (kw > BAS_KW_NONE && kw < BAS_KW_COUNT) ? KEYWORD_NAMES[kw] : "";
}

BAS_Keyword bas_keyword_from(const char *word) {
  for (int i = 1; i < BAS_KW_COUNT; i++) {
    const char *k = KEYWORD_NAMES[i];
    size_t j = 0;
    for (; k[j] && word[j]; j++) {
      if (toupper((unsigned char)word[j]) != k[j]) break;
    }
    if (!k[j] && !word[j]) return (BAS_Keyword)i;
  }
  return BAS_KW_NONE;
}

/* ------------------------------------------------------------------ growing */

static int push_token(BAS_TokenList *l, BAS_Token t) {
  if (l->count == l->capacity) {
    size_t cap = l->capacity ? l->capacity * 2 : 64;
    BAS_Token *grown = realloc(l->tokens, cap * sizeof *grown);
    if (!grown) return 0;
    l->tokens = grown;
    l->capacity = cap;
  }
  l->tokens[l->count++] = t;
  return 1;
}

static void push_error(BAS_TokenList *l, const char *msg, int line, int col,
                       int end_col) {
  if (l->error_count == l->error_capacity) {
    size_t cap = l->error_capacity ? l->error_capacity * 2 : 8;
    BAS_LexError *grown = realloc(l->errors, cap * sizeof *grown);
    if (!grown) return;
    l->errors = grown;
    l->error_capacity = cap;
  }
  BAS_LexError e;
  snprintf(e.message, sizeof e.message, "%s", msg);
  e.line = line;
  e.column = col;
  e.end_column = end_col;
  l->errors[l->error_count++] = e;
}

/* ------------------------------------------------------------------- lexing */

typedef struct {
  const char *src;
  size_t pos;
  int line;
  int col;
} Cursor;

static char peek(Cursor *c) { return c->src[c->pos]; }
static char peek_at(Cursor *c, size_t n) { return c->src[c->pos + n]; }

static char advance(Cursor *c) {
  char ch = c->src[c->pos++];
  c->col++;
  return ch;
}

static BAS_Token make(BAS_TokenType type, int line, int col, int end_col) {
  BAS_Token t;
  memset(&t, 0, sizeof t);
  t.type = type;
  t.line = line;
  t.column = col;
  t.end_column = end_col;
  return t;
}

/** A digit, or a dot that begins a number — `.033` has no leading zero. */
static int starts_number(Cursor *c) {
  char ch = peek(c);
  if (isdigit((unsigned char)ch)) return 1;
  return ch == '.' && isdigit((unsigned char)peek_at(c, 1));
}

/**
 * A number, including scientific notation.  The E is part of the number only
 * when a digit or a signed digit follows it; `1EX` is `1` then the variable
 * `EX`, which is what GW-BASIC does with it.
 */
static void lex_number(Cursor *c, BAS_TokenList *l) {
  int line = c->line, col = c->col;
  size_t start = c->pos;
  while (isdigit((unsigned char)peek(c))) advance(c);
  if (peek(c) == '.') {
    advance(c);
    while (isdigit((unsigned char)peek(c))) advance(c);
  }
  char e = peek(c);
  if (e == 'E' || e == 'e' || e == 'D' || e == 'd') {
    size_t n = 1;
    if (peek_at(c, n) == '+' || peek_at(c, n) == '-') n++;
    if (isdigit((unsigned char)peek_at(c, n))) {
      while (n--) advance(c);
      while (isdigit((unsigned char)peek(c))) advance(c);
    }
  }
  /* A trailing type sigil: GW-BASIC's !, # and % on a literal. */
  if (peek(c) == '!' || peek(c) == '#' || peek(c) == '%') advance(c);

  size_t len = c->pos - start;
  char buf[64];
  if (len >= sizeof buf) len = sizeof buf - 1;
  memcpy(buf, c->src + start, len);
  buf[len] = '\0';
  for (char *p = buf; *p; p++) {
    if (*p == 'D' || *p == 'd') *p = 'E';           /* D exponent is BASIC's */
    if (*p == '!' || *p == '#' || *p == '%') *p = '\0';
  }
  BAS_Token t = make(BAS_TOK_NUMBER, line, col, c->col);
  t.number = strtod(buf, NULL);
  push_token(l, t);
}

static void lex_word(Cursor *c, BAS_TokenList *l, int at_line_start) {
  (void)at_line_start;
  int line = c->line, col = c->col;
  size_t start = c->pos;
  while (isalnum((unsigned char)peek(c))) advance(c);
  if (peek(c) == '$' || peek(c) == '%' || peek(c) == '!' || peek(c) == '#') {
    advance(c);
  }
  size_t len = c->pos - start;
  char word[BAS_MAX_IDENT + 1];
  if (len > BAS_MAX_IDENT) len = BAS_MAX_IDENT;
  memcpy(word, c->src + start, len);
  word[len] = '\0';
  for (char *p = word; *p; p++) *p = (char)toupper((unsigned char)*p);

  /* REM takes the rest of the line, colons and all. */
  if (strcmp(word, "REM") == 0) {
    BAS_Token t = make(BAS_TOK_REM, line, col, c->col);
    while (peek(c) && peek(c) != '\n') advance(c);
    t.end_column = c->col;
    push_token(l, t);
    return;
  }

  BAS_Keyword kw = bas_keyword_from(word);
  BAS_Token t = make(kw ? BAS_TOK_KEYWORD : BAS_TOK_IDENT, line, col, c->col);
  t.keyword = kw;
  memcpy(t.text, word, strlen(word) + 1);
  push_token(l, t);
}

static void lex_string(Cursor *c, BAS_TokenList *l) {
  int line = c->line, col = c->col;
  advance(c); /* the opening quote */
  size_t start = c->pos;
  while (peek(c) && peek(c) != '"' && peek(c) != '\n') advance(c);
  size_t len = c->pos - start;
  if (peek(c) != '"') {
    push_error(l, "unterminated string", line, col, c->col);
  } else {
    advance(c); /* the closing quote */
  }
  BAS_Token t = make(BAS_TOK_STRING, line, col, c->col);
  if (len > BAS_MAX_IDENT) len = BAS_MAX_IDENT;
  memcpy(t.text, c->src + start, len);
  t.text[len] = '\0';
  push_token(l, t);
}

void bas_lex(const char *source, BAS_TokenList *out) {
  memset(out, 0, sizeof *out);
  if (!source) return;

  Cursor c = {source, 0, 1, 1};
  int at_line_start = 1;

  while (peek(&c)) {
    char ch = peek(&c);

    if (ch == '\n') {
      int line = c.line, col = c.col;
      advance(&c);
      push_token(out, make(BAS_TOK_EOL, line, col, col + 1));
      c.line++;
      c.col = 1;
      at_line_start = 1;
      continue;
    }
    if (ch == ' ' || ch == '\t' || ch == '\r') {
      advance(&c);
      continue;
    }

    /* The line number, and only at the start of a line. */
    if (at_line_start && isdigit((unsigned char)ch)) {
      int line = c.line, col = c.col;
      size_t start = c.pos;
      while (isdigit((unsigned char)peek(&c))) advance(&c);
      BAS_Token t = make(BAS_TOK_LINENO, line, col, c.col);
      char buf[16];
      size_t len = c.pos - start;
      if (len >= sizeof buf) len = sizeof buf - 1;
      memcpy(buf, source + start, len);
      buf[len] = '\0';
      t.number = strtod(buf, NULL);
      push_token(out, t);
      at_line_start = 0;
      continue;
    }
    at_line_start = 0;

    if (starts_number(&c)) { lex_number(&c, out); continue; }
    if (isalpha((unsigned char)ch)) { lex_word(&c, out, 0); continue; }
    if (ch == '"') { lex_string(&c, out); continue; }

    int line = c.line, col = c.col;
    advance(&c);
    BAS_TokenType type;
    switch (ch) {
      case ':': type = BAS_TOK_COLON; break;
      case ';': type = BAS_TOK_SEMICOLON; break;
      case ',': type = BAS_TOK_COMMA; break;
      case '(': type = BAS_TOK_LPAREN; break;
      case ')': type = BAS_TOK_RPAREN; break;
      case '+': type = BAS_TOK_PLUS; break;
      case '-': type = BAS_TOK_MINUS; break;
      case '*': type = BAS_TOK_STAR; break;
      case '/': type = BAS_TOK_SLASH; break;
      case '^': type = BAS_TOK_CARET; break;
      case '=': type = BAS_TOK_EQ; break;
      case '<':
        if (peek(&c) == '=') { advance(&c); type = BAS_TOK_LE; }
        else if (peek(&c) == '>') { advance(&c); type = BAS_TOK_NE; }
        else type = BAS_TOK_LT;
        break;
      case '>':
        if (peek(&c) == '=') { advance(&c); type = BAS_TOK_GE; }
        else type = BAS_TOK_GT;
        break;
      default: {
        char msg[64];
        snprintf(msg, sizeof msg, "unexpected character '%c'", ch);
        push_error(out, msg, line, col, c.col);
        continue;
      }
    }
    push_token(out, make(type, line, col, c.col));
  }

  push_token(out, make(BAS_TOK_EOF, c.line, c.col, c.col));
}

void bas_tokens_free(BAS_TokenList *list) {
  if (!list) return;
  free(list->tokens);
  free(list->errors);
  memset(list, 0, sizeof *list);
}
