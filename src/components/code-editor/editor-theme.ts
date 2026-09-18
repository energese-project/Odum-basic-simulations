/**
 * A Monaco theme built from the Energese tokens.
 *
 * This is the one place the palette has to be *resolved* rather than referred
 * to. Everything else on the page names a colour as `var(--e-ink)` and the
 * browser repaints it when the tokens change; Monaco's theme API takes literal
 * hex strings, so a theme is a snapshot and has to be rebuilt and re-applied
 * whenever the tokens move. `theme-changed` is what drives that — the same
 * event the chart canvas listens to, and for the same underlying reason.
 *
 * Three Monaco quirks that are easy to get wrong and silent or fatal when you do:
 *   - `rules[].foreground` wants hex WITHOUT the leading '#'; `colors` wants it
 *     WITH. A '#' in the wrong place is dropped rather than reported.
 *   - both want SIX digits. The production CSS minifier shortens `#ffffff` to
 *     `#fff`, which Monaco refuses outright — see hex.ts.
 *   - a bad value throws during construction, so the editor never appears at
 *     all. Hence normaliseHex returning null and the key being omitted, rather
 *     than a fallback colour invented here that would sit outside the token
 *     system and survive a palette change untouched.
 */

import type * as monaco from 'monaco-editor/editor/editor.api.js';
import { currentTheme, token } from '../../core/theme.ts';
import { TOKENS } from '../../basic/basic-language.ts';
import { normaliseHex } from './hex.ts';

export const EDITOR_THEME_ID = 'energese';

/** `#rrggbb` for `colors`, or null when the token is missing. */
function hex(name: string): string | null {
  return normaliseHex(token(name));
}

/** The same colour without the '#', which is what `rules` require. */
function bare(name: string): string | undefined {
  return hex(name)?.slice(1);
}

function rule(tokenName: string, colour: string, fontStyle?: string): monaco.editor.ITokenThemeRule[] {
  const foreground = bare(colour);
  return foreground ? [{ token: tokenName, foreground, ...(fontStyle ? { fontStyle } : {}) }] : [];
}

export function energeseEditorTheme(): monaco.editor.IStandaloneThemeData {
  const colors: Record<string, string> = {};
  const set = (key: string, name: string): void => {
    const value = hex(name);
    if (value) colors[key] = value;
  };

  set('editor.background', '--e-surface');
  set('editor.foreground', '--e-ink');
  set('editorLineNumber.foreground', '--e-tick');
  set('editorLineNumber.activeForeground', '--e-muted');
  set('editorGutter.background', '--e-surface-sunken');
  set('editor.lineHighlightBackground', '--e-surface-sunken');
  set('editor.selectionBackground', '--e-accent-soft');
  set('editor.inactiveSelectionBackground', '--e-surface-sunken');
  set('editorCursor.foreground', '--e-accent');
  set('editorWidget.background', '--e-surface');
  set('editorWidget.border', '--e-rule');
  set('editorIndentGuide.background1', '--e-rule');
  set('scrollbarSlider.background', '--e-rule');
  set('scrollbarSlider.hoverBackground', '--e-axis');
  set('scrollbarSlider.activeBackground', '--e-muted');

  return {
    // `base` is picked from the current theme and `inherit` is true, so the
    // hundreds of Monaco surfaces this file does not name (find widget, context
    // menu, suggestion list) start from the right side of light/dark instead of
    // from whichever one happened to be the default. The rules and colors below
    // then override everything the editor actually shows for this language.
    base: currentTheme() === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      ...rule('', '--e-ink'),
      ...rule('comment', '--e-muted', 'italic'),
      ...rule('keyword', '--e-series-3', 'bold'),
      ...rule('string', '--e-series-1'),
      ...rule('number', '--e-series-2'),
      ...rule('predefined', '--e-series-7'),
      ...rule('operator', '--e-muted'),
      ...rule('delimiter', '--e-muted'),
      ...rule('identifier', '--e-ink'),
      // Statements the highlighter knows and the interpreter does not yet run.
      ...rule(TOKENS.planned, '--e-series-4', 'italic'),
      ...rule(TOKENS.lineNumber, '--e-tick'),
    ],
    colors,
  };
}
