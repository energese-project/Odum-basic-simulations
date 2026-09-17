import { BaseComponent } from '../../core/base-component.ts';
import { basic } from '../../basic/basic-language.ts';
import template from './code-editor.html?raw';
import style from './code-editor.css?raw';

import { EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Every colour is a `var(--e-...)`, not a resolved value, which is what makes
 * light and dark free here: the tokens are redefined by energese.css and the
 * browser repaints the editor with them. A conventional CodeMirror theme pair
 * would need two extensions and a Compartment reconfigure on every toggle, and
 * would still miss the OS-preference route.
 */
const energeseTheme = EditorView.theme({
  '&': {
    color: 'var(--e-ink)',
    backgroundColor: 'var(--e-surface)',
    height: '100%',
  },
  '.cm-content': {
    caretColor: 'var(--e-accent)',
    padding: '0.5rem 0',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--e-accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    color: 'var(--e-tick)',
    backgroundColor: 'var(--e-surface-sunken)',
    border: 'none',
    borderRight: '1px solid var(--e-rule)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--e-surface-sunken)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--e-surface-sunken)',
    color: 'var(--e-muted)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--e-accent-soft)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--e-accent-soft)',
    color: 'var(--e-accent-on-soft)',
    outline: 'none',
  },
});

/**
 * Syntax colours come from the series ramp rather than a stock editor theme, so
 * the editor and the chart beside it are visibly the same palette. The slots are
 * the validated ones, used for their hue and not reordered — see the header of
 * styles/energese.css for why that order is not a matter of taste.
 */
const energeseHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--e-muted)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--e-series-3)', fontWeight: '600' },
  { tag: tags.string, color: 'var(--e-series-1)' },
  { tag: tags.number, color: 'var(--e-series-2)' },
  { tag: tags.operator, color: 'var(--e-muted)' },
  { tag: tags.standard(tags.variableName), color: 'var(--e-series-7)' },
  { tag: tags.variableName, color: 'var(--e-ink)' },
  // The line number that opens each statement. Structure, not a magnitude.
  { tag: tags.meta, color: 'var(--e-tick)' },
]);

export class CodeEditorComponent extends BaseComponent {
  static tagName = 'code-editor';

  private view: EditorView | null = null;

  constructor() {
    super(template, style);
  }

  init(): void {
    const mount = this.querySelector<HTMLElement>('.mount');
    if (!mount) return;

    this.view = new EditorView({ parent: mount, state: CodeEditorComponent.stateFor('') });
  }

  private static stateFor(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        // indentWithTab last so it does not shadow the default Tab handling
        // used to leave the editor; it is here because BASIC listings are
        // pasted in far more often than they are tab-navigated out of.
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        basic(),
        syntaxHighlighting(energeseHighlight),
        energeseTheme,
        EditorView.lineWrapping,
      ],
    });
  }

  disconnectedCallback(): void {
    this.view?.destroy();
    this.view = null;
  }

  get value(): string {
    return this.view?.state.doc.toString() ?? '';
  }

  /**
   * Replaces the whole document with a new state rather than dispatching a
   * change, because loading a different program should not leave the previous
   * one one Ctrl-Z away. Edits within a program stay undoable as usual.
   */
  set value(source: string) {
    this.view?.setState(CodeEditorComponent.stateFor(source));
  }
}

if (!customElements.get(CodeEditorComponent.tagName)) {
  customElements.define(CodeEditorComponent.tagName, CodeEditorComponent);
}
