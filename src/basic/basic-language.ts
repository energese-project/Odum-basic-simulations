/**
 * A Monaco language for the BASIC these programs are written in.
 *
 * Monaco ships 81 grammars and none of them is this language. The two it has
 * with "basic" in the name are `sb` (Microsoft Small Basic) and `vb` (Visual
 * Basic); neither has line numbers, and their keyword sets are different. So
 * the grammar below is hand-written in Monarch, which is the right answer
 * anyway: the dialect is the one in the books, so the keyword list can be
 * exactly the one the interpreter implements plus the ones it is going to.
 *
 * Keywords are split into two lists on purpose. `KEYWORDS` is what runs today.
 * `PLANNED` is highlighted but not executed — the graphics and structured-
 * control statements the published listings use, which are on the roadmap.
 * Highlighting them is honest: they are BASIC, they are just not implemented
 * yet, and a program using them should look like code rather than like a
 * syntax error while it waits for TODO.md to be worked through. They are given
 * their own token so the theme can mark them as provisional rather than
 * letting them pass for something that will run.
 */

import type * as monaco from 'monaco-editor/editor/editor.api.js';

export const BASIC_LANGUAGE_ID = 'odum-basic';

export const KEYWORDS = [
  'PRINT', 'LET', 'INPUT', 'IF', 'THEN', 'FOR', 'TO', 'STEP', 'NEXT',
  'GOTO', 'GOSUB', 'RETURN', 'DIM', 'READ', 'DATA', 'RESTORE',
  'REM', 'END', 'STOP', 'RANDOMIZE', 'AND', 'OR', 'NOT',
];

export const PLANNED = [
  'WHILE', 'WEND', 'DO', 'LOOP', 'UNTIL', 'SELECT', 'CASE', 'ELSE',
  'DEF', 'FN', 'ON', 'SCREEN', 'CLS', 'PSET', 'LINE', 'LOCATE',
  'COLOR', 'USING', 'TIMER', 'CIRCLE', 'PAINT', 'VIEW', 'WINDOW',
];

export const BUILTINS = [
  'LEN', 'MID$', 'LEFT$', 'RIGHT$', 'STR$', 'CHR$', 'VAL', 'ASC',
  'INT', 'ABS', 'SGN', 'SQR', 'SIN', 'COS', 'TAN', 'ATN', 'EXP', 'LOG', 'RND',
];

/** Token names the theme in editor-theme.ts paints. */
export const TOKENS = {
  lineNumber: 'linenumber.basic',
  planned: 'planned.basic',
} as const;

export const basicMonarch: monaco.languages.IMonarchLanguage = {
  ignoreCase: true,
  defaultToken: '',
  keywords: KEYWORDS,
  planned: PLANNED,
  builtins: BUILTINS,

  tokenizer: {
    root: [
      // The line number that opens each statement. Structure, not a magnitude,
      // so it gets its own token rather than being painted like a constant.
      // `^` only matches at offset 0, which is exactly where a line number is.
      [/^\s*\d+/, TOKENS.lineNumber],

      // REM comments out the rest of the line, colons included — the same rule
      // the interpreter's splitStatements() follows. Tested there, because a
      // prose comment with a colon in it used to be executed as a statement.
      [/\bREM\b.*$/, 'comment'],
      [/'.*$/, 'comment'],

      [/"([^"\\]|\\.)*"?/, 'string'],

      // Identifiers before numbers: a bare word can be a keyword, a builtin
      // (which may end in `$`) or a variable, and only the table knows which.
      [
        /[A-Za-z][A-Za-z0-9]*\$?/,
        {
          cases: {
            '@builtins': 'predefined',
            '@keywords': 'keyword',
            '@planned': TOKENS.planned,
            '@default': 'identifier',
          },
        },
      ],

      [/\d+(\.\d+)?([Ee][+-]?\d+)?/, 'number'],
      [/[-+*/^=<>]+/, 'operator'],
      [/[(),;:]/, 'delimiter'],
      [/\s+/, ''],
    ],
  },
};

export const basicLanguageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: 'REM' },
  brackets: [['(', ')']],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
};
