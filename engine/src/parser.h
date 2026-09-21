/**
 * The AST, and the parser that builds it.
 *
 * Shared by the validator and the evaluator, which is the reason it exists as
 * its own stage: real-time checking in an editor must parse without running,
 * and two parsers for one dialect would drift apart and then disagree about
 * what a listing means.
 *
 * The parser never stops at the first error.  A listing being transcribed is
 * wrong in several places at once, and an editor that reveals one mistake per
 * save is worse than no editor.  Errors are collected and parsing resumes at
 * the next line.
 */

#ifndef BASIC_PARSER_H
#define BASIC_PARSER_H

#include "lexer.h"

typedef enum {
  BAS_EXPR_NUMBER,
  BAS_EXPR_STRING,
  BAS_EXPR_VAR,     /**< A variable, or an array element when arg_count > 0. */
  BAS_EXPR_CALL,    /**< A built-in: SIN, EXP, INT and the rest. */
  BAS_EXPR_UNARY,
  BAS_EXPR_BINARY
} BAS_ExprType;

typedef struct BAS_Expr BAS_Expr;
struct BAS_Expr {
  BAS_ExprType type;
  double number;                   /**< NUMBER. */
  char name[BAS_MAX_IDENT + 1];    /**< STRING's text, VAR's and CALL's name. */
  BAS_TokenType op;                /**< UNARY and BINARY. */
  BAS_Keyword op_kw;               /**< AND, OR and NOT, which lex as keywords. */
  BAS_Expr *left;
  BAS_Expr *right;
  BAS_Expr **args;                 /**< CALL's arguments, VAR's subscripts. */
  size_t arg_count;
  int line, column, end_column;
};

typedef enum {
  BAS_ST_LET, BAS_ST_PRINT, BAS_ST_IF, BAS_ST_FOR, BAS_ST_NEXT,
  BAS_ST_GOTO, BAS_ST_GOSUB, BAS_ST_RETURN, BAS_ST_END, BAS_ST_STOP,
  BAS_ST_REM, BAS_ST_CLS, BAS_ST_SCREEN, BAS_ST_COLOR,
  BAS_ST_PSET, BAS_ST_PRESET, BAS_ST_LINE,
  BAS_ST_DIM, BAS_ST_READ, BAS_ST_DATA, BAS_ST_RESTORE,
  BAS_ST_INPUT, BAS_ST_RANDOMIZE,
  BAS_ST_UNSUPPORTED               /**< Parsed, recognised, not implemented. */
} BAS_StmtType;

/** How many expression slots one statement can hold: LINE's is the widest. */
#define BAS_MAX_STMT_EXPR 8

typedef struct BAS_Stmt BAS_Stmt;
struct BAS_Stmt {
  BAS_StmtType type;
  char name[BAS_MAX_IDENT + 1];    /**< LET's target, FOR's and NEXT's variable. */
  BAS_Expr *e[BAS_MAX_STMT_EXPR];
  size_t e_count;
  BAS_Expr **subscripts;           /**< LET into an array element. */
  size_t subscript_count;
  int target;                      /**< GOTO, GOSUB, and IF..THEN <line>. */
  int has_target;
  BAS_Stmt *then_branch;           /**< IF .. THEN <statement>. */
  /**
   * PRINT's separators: sep[i] is the one that FOLLOWED e[i], ',' or ';', and
   * 0 for none.  They decide the layout — a comma moves to the next print
   * zone, a semicolon does not — so dropping them, as this parser used to,
   * makes `PRINT "T", "Q"` and `PRINT "T"; "Q"` indistinguishable.
   */
  char sep[BAS_MAX_STMT_EXPR];
  /** PRINT ended with a separator, so the line stays open for the next one. */
  int trailing_sep;
  int box;                         /**< LINE's B and BF clauses. */
  int filled;
  int line_number;                 /**< The listing's number, for jumps. */
  int line, column, end_column;    /**< Where in the file, for diagnostics. */
};

typedef struct {
  char message[128];
  int line, column, end_column;
  int is_unsupported;              /**< "not supported yet", not "syntax". */
} BAS_ParseError;

typedef struct {
  BAS_Stmt **stmts;
  size_t count;
  size_t capacity;
  BAS_ParseError *errors;
  size_t error_count;
  size_t error_capacity;
} BAS_Program;

/**
 * Parse `source`.  Always produces a program; check `error_count` rather than
 * a return value, because a partial parse is still useful to a validator.
 */
void bas_parse(const char *source, BAS_Program *out);

void bas_program_free(BAS_Program *prog);

/** Record an error on a program, used by the parser and the validator alike. */
void bas_program_error(BAS_Program *prog, const char *msg, int line, int column,
                       int end_column, int is_unsupported);

/** True for a word in basic-language.ts's PLANNED list: BASIC, not implemented. */
int bas_is_planned(const char *word);

/** True for a built-in function name the evaluator knows. */
int bas_is_builtin(const char *word);

#endif /* BASIC_PARSER_H */
