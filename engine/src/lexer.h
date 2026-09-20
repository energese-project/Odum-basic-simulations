/**
 * Tokens of the dialect the archive's listings are written in.
 *
 * Internal to the engine: the public surface is basic.h.  The lexer is split
 * out because the validator needs it without the evaluator — real-time
 * checking in an editor must not run the program.
 */

#ifndef BASIC_LEXER_H
#define BASIC_LEXER_H

#include <stddef.h>

/**
 * Keywords this engine executes.  The list is deliberately the same one
 * src/basic/basic-language.ts highlights as KEYWORDS, so the editor and the
 * engine cannot disagree about what runs.  Words in that file's PLANNED list
 * are not here: they lex as identifiers and the parser reports them as
 * unsupported, which is a better error than "syntax".
 */
typedef enum {
  BAS_KW_NONE = 0,
  BAS_KW_PRINT, BAS_KW_LET, BAS_KW_INPUT, BAS_KW_IF, BAS_KW_THEN,
  BAS_KW_FOR, BAS_KW_TO, BAS_KW_STEP, BAS_KW_NEXT,
  BAS_KW_GOTO, BAS_KW_GOSUB, BAS_KW_RETURN,
  BAS_KW_DIM, BAS_KW_READ, BAS_KW_DATA, BAS_KW_RESTORE,
  BAS_KW_END, BAS_KW_STOP, BAS_KW_RANDOMIZE,
  BAS_KW_AND, BAS_KW_OR, BAS_KW_NOT,
  BAS_KW_SCREEN, BAS_KW_COLOR, BAS_KW_CLS,
  BAS_KW_PSET, BAS_KW_PRESET, BAS_KW_LINE,
  BAS_KW_COUNT
} BAS_Keyword;

typedef enum {
  BAS_TOK_EOF = 0,
  BAS_TOK_EOL,
  BAS_TOK_LINENO,     /**< The number that opens a line: structure, not a value. */
  BAS_TOK_NUMBER,
  BAS_TOK_STRING,
  BAS_TOK_IDENT,
  BAS_TOK_KEYWORD,
  BAS_TOK_REM,        /**< REM and everything after it on the line. */
  BAS_TOK_COLON, BAS_TOK_SEMICOLON, BAS_TOK_COMMA,
  BAS_TOK_LPAREN, BAS_TOK_RPAREN,
  BAS_TOK_PLUS, BAS_TOK_MINUS, BAS_TOK_STAR, BAS_TOK_SLASH, BAS_TOK_CARET,
  BAS_TOK_EQ, BAS_TOK_LT, BAS_TOK_GT, BAS_TOK_LE, BAS_TOK_GE, BAS_TOK_NE
} BAS_TokenType;

/** Identifiers in this dialect are short; the cap is generous and checked. */
#define BAS_MAX_IDENT 32

typedef struct {
  BAS_TokenType type;
  BAS_Keyword keyword;            /**< BAS_KW_NONE unless type is KEYWORD. */
  double number;                  /**< LINENO and NUMBER.  Narrowed later. */
  char text[BAS_MAX_IDENT + 1];   /**< IDENT (upper-cased) and STRING. */
  int line;                       /**< 1-based, of the source file. */
  int column;                     /**< 1-based, inclusive. */
  int end_column;                 /**< 1-based, exclusive, as Monaco means it. */
} BAS_Token;

typedef struct {
  char message[128];
  int line;
  int column;
  int end_column;
} BAS_LexError;

typedef struct {
  BAS_Token *tokens;
  size_t count;
  size_t capacity;
  BAS_LexError *errors;
  size_t error_count;
  size_t error_capacity;
} BAS_TokenList;

/**
 * Tokenise `source` into `out`.  Always produces a list: a source with errors
 * still lexes as far as it can, so the validator can report more than the first
 * problem.  The caller frees with bas_tokens_free.
 */
void bas_lex(const char *source, BAS_TokenList *out);

void bas_tokens_free(BAS_TokenList *list);

/** The keyword `word` names, or BAS_KW_NONE.  Case-insensitive. */
BAS_Keyword bas_keyword_from(const char *word);

/** The spelling of a keyword, for messages. */
const char *bas_keyword_name(BAS_Keyword kw);

#endif /* BASIC_LEXER_H */
