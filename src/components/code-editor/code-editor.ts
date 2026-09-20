import { BaseComponent } from '../../core/base-component.ts';
import {
  BASIC_LANGUAGE_ID,
  basicLanguageConfiguration,
  basicMonarch,
} from '../../basic/basic-language.ts';
import { EDITOR_THEME_ID, energeseEditorTheme } from './editor-theme.ts';
import { watchDiagnostics } from './diagnostics.ts';
import template from './code-editor.html?raw';
import style from './code-editor.css?raw';

// The `editor.api` entry, not the package root. Importing 'monaco-editor'
// pulls in all 81 bundled grammars and an LSP client, none of which this
// application uses — the only language here is the Monarch one in
// basic-language.ts. Note the specifier shape: monaco's exports map is
// `"./*": "./esm/vs/*.js"`, so the historical `monaco-editor/esm/vs/...` deep
// path no longer resolves and would double the prefix.
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

/**
 * Monaco resolves its workers through this global. Without it Monaco guesses a
 * URL, fails to fetch it, and falls back to running everything on the main
 * thread with a console warning — which works well enough to hide the problem.
 * Only the base editor worker is needed: the language services that need their
 * own workers (TypeScript, JSON, CSS, HTML) are not bundled here.
 */
declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

window.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

let languageRegistered = false;

/** Registered once per page, not per component — Monaco keeps languages in a
 *  global registry and re-registering stacks duplicate tokenizers. */
function registerBasicLanguage(): void {
  if (languageRegistered) return;
  languageRegistered = true;
  monaco.languages.register({ id: BASIC_LANGUAGE_ID, extensions: ['.bas'] });
  monaco.languages.setMonarchTokensProvider(BASIC_LANGUAGE_ID, basicMonarch);
  monaco.languages.setLanguageConfiguration(BASIC_LANGUAGE_ID, basicLanguageConfiguration);
}

export class CodeEditorComponent extends BaseComponent {
  static tagName = 'code-editor';

  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private onThemeChanged = (): void => this.applyTheme();
  /** Stops the checker watching the model it was started on. */
  private stopDiagnostics: (() => void) | null = null;

  constructor() {
    super(template, style);
  }

  init(): void {
    const mount = this.querySelector<HTMLElement>('.mount');
    if (!mount) return;

    registerBasicLanguage();
    this.applyTheme();

    this.editor = monaco.editor.create(mount, {
      value: '',
      language: BASIC_LANGUAGE_ID,
      theme: EDITOR_THEME_ID,
      // The panel is a flex child whose height comes from the grid, so Monaco
      // has to watch its own box; it does not reflow on a container resize
      // otherwise, and the editor keeps the size it had at first paint.
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
      lineNumbersMinChars: 3,
      renderLineHighlight: 'line',
      smoothScrolling: true,
      // These programs are a few dozen lines of numbered statements. There is
      // nothing to fold, no symbols to navigate, and no second file to compare.
      folding: false,
      occurrencesHighlight: 'off',
      renderWhitespace: 'none',
      scrollbar: { alwaysConsumeMouseWheel: false },
    });

    // Typing, not loading: setModel() in the value setter does not fire this,
    // so a listener can save what the reader wrote without saving every load.
    this.editor.onDidChangeModelContent(() => {
      this.dispatchEvent(new CustomEvent('editor-change', { bubbles: true }));
    });

    this.watchModel();

    // Monaco paints its own pixels from a resolved palette, so like the chart
    // canvas it has to be told when the tokens move. See editor-theme.ts.
    window.addEventListener('theme-changed', this.onThemeChanged);
  }

  disconnectedCallback(): void {
    window.removeEventListener('theme-changed', this.onThemeChanged);
    this.stopDiagnostics?.();
    this.stopDiagnostics = null;
    this.editor?.getModel()?.dispose();
    this.editor?.dispose();
    this.editor = null;
  }

  /** Point the checker at the editor's current model, dropping the previous one. */
  private watchModel(): void {
    this.stopDiagnostics?.();
    this.stopDiagnostics = null;
    const model = this.editor?.getModel();
    if (model) this.stopDiagnostics = watchDiagnostics(monaco, model);
  }

  private applyTheme(): void {
    monaco.editor.defineTheme(EDITOR_THEME_ID, energeseEditorTheme());
    monaco.editor.setTheme(EDITOR_THEME_ID);
  }

  focus(): void {
    this.editor?.focus();
  }

  get value(): string {
    return this.editor?.getValue() ?? '';
  }

  /**
   * Replaces the model rather than calling setValue, because loading a
   * different program should not leave the previous one one Ctrl-Z away. Edits
   * within a program stay undoable as usual.
   */
  set value(source: string) {
    if (!this.editor) return;
    const previous = this.editor.getModel();
    this.editor.setModel(monaco.editor.createModel(source, BASIC_LANGUAGE_ID));
    previous?.dispose();
    // The markers belong to the model, not the editor, so a new model starts
    // unchecked until the checker is pointed at it.
    this.watchModel();
  }
}

if (!customElements.get(CodeEditorComponent.tagName)) {
  customElements.define(CodeEditorComponent.tagName, CodeEditorComponent);
}
