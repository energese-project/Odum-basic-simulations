/**
 * A CodeMirror language for the BASIC these programs are written in.
 *
 * `@codemirror/legacy-modes` has no BASIC mode — it ships `vb` and `vbscript`,
 * which are a different language with a different keyword set and no line
 * numbers. What it does ship is `simple-mode`, the declarative tokenizer from
 * CodeMirror 5, and a hand-written mode is the better answer here anyway: the
 * dialect is the one in the books, so the keyword list can be exactly the one
 * the interpreter implements plus the ones it is going to.
 *
 * Keywords are split into three lists on purpose. `KEYWORDS` is what runs today.
 * `PLANNED` is accepted by the highlighter but not by the interpreter — the
 * graphics and structured-control statements the published listings use, which
 * are on the roadmap. Highlighting them is honest: they are BASIC, they are just
 * not implemented, and a program using them should look like code rather than
 * like a syntax error while it waits for TODO.md to be worked through.
 */

import { LanguageSupport, StreamLanguage } from '@codemirror/language';
import { simpleMode } from '@codemirror/legacy-modes/mode/simple-mode';

const KEYWORDS = [
  'PRINT', 'LET', 'INPUT', 'IF', 'THEN', 'FOR', 'TO', 'STEP', 'NEXT',
  'GOTO', 'GOSUB', 'RETURN', 'DIM', 'READ', 'DATA', 'RESTORE',
  'REM', 'END', 'STOP', 'RANDOMIZE', 'AND', 'OR', 'NOT',
];

const PLANNED = [
  'WHILE', 'WEND', 'DO', 'LOOP', 'UNTIL', 'SELECT', 'CASE', 'ELSE',
  'DEF', 'FN', 'ON', 'SCREEN', 'CLS', 'PSET', 'LINE', 'LOCATE',
  'COLOR', 'USING', 'TIMER', 'CIRCLE', 'PAINT', 'VIEW', 'WINDOW',
];

const FUNCTIONS = [
  'LEN', 'MID\\$', 'LEFT\\$', 'RIGHT\\$', 'STR\\$', 'CHR\\$', 'VAL', 'ASC',
  'INT', 'ABS', 'SGN', 'SQR', 'SIN', 'COS', 'TAN', 'ATN', 'EXP', 'LOG', 'RND',
];

const word = (list: string[]): RegExp => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');

export const basicMode = simpleMode({
  start: [
    // A leading line number is the program's structure, not a magnitude, so it
    // is toned down rather than coloured like the constants beside it.
    { regex: /^\s*\d+/, token: 'meta', sol: true },

    // REM swallows the rest of the line, so it has to be tested before the
    // keyword list would match it as a bare word.
    { regex: /\b(?:REM)\b.*/i, token: 'comment' },
    { regex: /'.*/, token: 'comment' },

    { regex: /"(?:[^"\\]|\\.)*"?/, token: 'string' },

    { regex: word(FUNCTIONS), token: 'builtin' },
    { regex: word(KEYWORDS), token: 'keyword' },
    { regex: word(PLANNED), token: 'keyword' },

    { regex: /\b\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?\b/, token: 'number' },
    { regex: /[-+*/^=<>]+/, token: 'operator' },
    { regex: /\b[A-Za-z][A-Za-z0-9]*\$?/, token: 'variable' },
  ],
  languageData: {
    commentTokens: { line: 'REM' },
  },
});

export const basicLanguage = StreamLanguage.define(basicMode);

export function basic(): LanguageSupport {
  return new LanguageSupport(basicLanguage);
}
