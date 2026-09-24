/**
 * Enough of a JSON grammar to read a sidecar by.
 *
 * Monaco's own JSON support is a language service with a worker of its own,
 * which the `editor.api` entry deliberately leaves out (see code-editor.ts). The
 * explorer only ever shows JSON read-only, so it needs colouring, not
 * completion or validation — the build has already validated every file it
 * publishes. Keys and string values are told apart, because in a sidecar the
 * keys are the vocabulary a reader is learning.
 */

import type * as monaco from 'monaco-editor/editor/editor.api.js';

export const JSON_LANGUAGE_ID = 'odum-json';

const STRING = /"(?:[^"\\]|\\.)*"/;

export const jsonMonarch: monaco.languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [new RegExp(`${STRING.source}(?=\\s*:)`), 'predefined'],
      [STRING, 'string'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/[{}[\],:]/, 'delimiter'],
    ],
  },
};
