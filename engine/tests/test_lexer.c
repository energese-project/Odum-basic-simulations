/**
 * The lexer, tested against the dialect as the listings actually write it
 * rather than as a tidy grammar would like it.  Every case here is taken from
 * a line in validation/oracle/table3.bas or from a failure the TypeScript
 * interpreter's history records, because those are the things this dialect
 * does that a general BASIC lexer gets wrong.
 */

#include "../src/lexer.h"
#include "test.h"

/** Lex a whole source and hand back the token array, for the checks below. */
static BAS_TokenList lex(const char *src) {
  BAS_TokenList list;
  bas_lex(src, &list);
  return list;
}

/* A pointer, not a copy: the checks read .text, which must outlive the call. */
static const BAS_Token *tok(BAS_TokenList *l, size_t i) { return &l->tokens[i]; }

int main(void) {
  {
    TEST("a line number opens a line and is not a numeric literal");
    BAS_TokenList l = lex("10 K0 = 2.3\n");
    CHECK_INT(tok(&l, 0)->type, BAS_TOK_LINENO);
    CHECK_INT(tok(&l, 0)->number, 10);
    CHECK_INT(tok(&l, 1)->type, BAS_TOK_IDENT);
    CHECK_STR(tok(&l, 1)->text, "K0");
    bas_tokens_free(&l);
  }

  {
    /* `49 K8= .01` — no space before `=`, and a literal with no leading zero.
       Both appear in table3.bas and both have broken a tokenizer before. */
    TEST("an identifier ends at an operator with no space, and .01 is a number");
    BAS_TokenList l = lex("49 K8= .01\n");
    CHECK_INT(tok(&l, 1)->type, BAS_TOK_IDENT);
    CHECK_STR(tok(&l, 1)->text, "K8");
    CHECK_INT(tok(&l, 2)->type, BAS_TOK_EQ);
    CHECK_INT(tok(&l, 3)->type, BAS_TOK_NUMBER);
    CHECK(tok(&l, 3)->number > 0.0099 && tok(&l, 3)->number < 0.0101);
    bas_tokens_free(&l);
  }

  {
    /* The rate coefficients are written this way, and `1E-3` tokenizing the E
       as a variable is a bug the TypeScript interpreter had and fixed. */
    TEST("scientific notation is one number, not a number and a variable");
    BAS_TokenList l = lex("10 X = 1E-3\n");
    CHECK_INT(tok(&l, 3)->type, BAS_TOK_NUMBER);
    CHECK(tok(&l, 3)->number > 0.00099 && tok(&l, 3)->number < 0.00101);
    CHECK_INT(tok(&l, 4)->type, BAS_TOK_EOL);
    bas_tokens_free(&l);
  }

  {
    /* REM swallows the rest of the line including colons.  A prose comment
       chopped at its first colon and the remainder executed is a real listing
       failure, caught by the e2e suite and not by reading. */
    TEST("REM swallows the rest of the line, colons included");
    BAS_TokenList l = lex("3 REM DEVELOP: H.T.Odum\n4 CLS\n");
    CHECK_INT(tok(&l, 1)->type, BAS_TOK_REM);
    CHECK_INT(tok(&l, 2)->type, BAS_TOK_EOL);
    CHECK_INT(tok(&l, 3)->type, BAS_TOK_LINENO);
    CHECK_INT(tok(&l, 3)->number, 4);
    bas_tokens_free(&l);
  }

  {
    TEST("a colon separates statements on one line");
    BAS_TokenList l = lex("5 SCREEN 1,0: COLOR 0,0\n");
    CHECK_INT(tok(&l, 1)->type, BAS_TOK_KEYWORD);
    CHECK_INT(tok(&l, 1)->keyword, BAS_KW_SCREEN);
    CHECK_INT(tok(&l, 5)->type, BAS_TOK_COLON);
    CHECK_INT(tok(&l, 6)->keyword, BAS_KW_COLOR);
    bas_tokens_free(&l);
  }

  {
    /* `6 LINE (0,0)-(319,180),3,B` — the B is a clause of LINE, not a variable,
       but the lexer does not know that; it must hand the parser an identifier
       and let the parser decide.  The test pins the division of labour. */
    TEST("LINE's box clause lexes as punctuation and an identifier");
    BAS_TokenList l = lex("6 LINE (0,0)-(319,180),3,B\n");
    CHECK_INT(tok(&l, 1)->keyword, BAS_KW_LINE);
    CHECK_INT(tok(&l, 2)->type, BAS_TOK_LPAREN);
    CHECK_INT(tok(&l, 7)->type, BAS_TOK_MINUS);
    CHECK_INT(tok(&l, 16)->type, BAS_TOK_IDENT);
    CHECK_STR(tok(&l, 16)->text, "B");
    bas_tokens_free(&l);
  }

  {
    /* Keywords are case-insensitive and the listings are inconsistent about it.
       `GOTO` and `Goto` are the same statement. */
    TEST("keywords are recognised whatever their case");
    BAS_TokenList l = lex("400 IF T < 320 GOTO 200\n");
    CHECK_INT(tok(&l, 1)->keyword, BAS_KW_IF);
    CHECK_INT(tok(&l, 5)->keyword, BAS_KW_GOTO);
    BAS_TokenList m = lex("400 if t < 320 goto 200\n");
    CHECK_INT(tok(&m, 1)->keyword, BAS_KW_IF);
    CHECK_INT(tok(&m, 5)->keyword, BAS_KW_GOTO);
    bas_tokens_free(&l);
    bas_tokens_free(&m);
  }

  {
    TEST("a string literal keeps its contents and drops its quotes");
    BAS_TokenList l = lex("10 PRINT \"T = \"; T\n");
    CHECK_INT(tok(&l, 2)->type, BAS_TOK_STRING);
    CHECK_STR(tok(&l, 2)->text, "T = ");
    CHECK_INT(tok(&l, 3)->type, BAS_TOK_SEMICOLON);
    bas_tokens_free(&l);
  }

  {
    /* A variable name may end in $ — that is part of the name, not an operator. */
    TEST("a string variable's $ belongs to its name");
    BAS_TokenList l = lex("10 X$ = \"a\"\n");
    CHECK_INT(tok(&l, 1)->type, BAS_TOK_IDENT);
    CHECK_STR(tok(&l, 1)->text, "X$");
    bas_tokens_free(&l);
  }

  {
    TEST("every token carries the line and column it came from");
    BAS_TokenList l = lex("10 K0 = 2.3\n");
    CHECK_INT(tok(&l, 1)->line, 1);
    CHECK_INT(tok(&l, 1)->column, 4);
    CHECK_INT(tok(&l, 1)->end_column, 6);
    bas_tokens_free(&l);
  }

  {
    TEST("an unterminated string is reported, not silently closed");
    BAS_TokenList l = lex("10 PRINT \"oops\n");
    CHECK_INT(l.error_count, 1);
    CHECK_INT(l.errors[0].line, 1);
    bas_tokens_free(&l);
  }

  TEST_REPORT();
}
