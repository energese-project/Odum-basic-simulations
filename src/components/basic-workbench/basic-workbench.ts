import { BaseComponent } from '../../core/base-component.ts';
import { bindInternalLinks } from '../../core/internal-links.ts';
import { Router } from '../../core/router/router.ts';
import { Runner } from '../../basic/runner.ts';
import { extractPlot, toCsv, type Plot } from '../../basic/output.ts';
import { findProgram, programs } from '../../basic/programs.ts';
import template from './basic-workbench.html?raw';
import style from './basic-workbench.css?raw';

import '../code-editor/code-editor.ts';
import '../console-panel/console-panel.ts';
import '../chart-panel/chart-panel.ts';
import '../theme-toggle/theme-toggle.ts';

import type { CodeEditorComponent } from '../code-editor/code-editor.ts';
import type { ConsolePanelComponent } from '../console-panel/console-panel.ts';
import type { ChartPanelComponent } from '../chart-panel/chart-panel.ts';

/** How often the chart is re-derived while a program is still running. Often
 *  enough that a long integration visibly draws itself, rarely enough that
 *  re-parsing the transcript is not the dominant cost. */
const REPLOT_MS = 250;

export class BasicWorkbenchComponent extends BaseComponent {
  static tagName = 'basic-workbench';

  /** Set by the router from the query string. */
  query?: Record<string, string>;

  private runner: Runner | null = null;
  private plot: Plot | null = null;
  private running = false;
  private replotTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super(template, style);
  }

  private get editor(): CodeEditorComponent | null {
    return this.querySelector('code-editor');
  }

  private get console(): ConsolePanelComponent | null {
    return this.querySelector('console-panel');
  }

  private get chart(): ChartPanelComponent | null {
    return this.querySelector('chart-panel');
  }

  init(): void {
    bindInternalLinks(this);

    this.runner = new Runner({
      onOutput: (text) => this.console?.append(text),
      onInputRequest: () => this.console?.askForInput(),
      onDone: () => this.finish(),
      onError: (message) => {
        this.console?.append(`\n?${message}\n`);
        this.finish();
      },
    });

    this.fillProgramList();
    this.wireControls();
    this.loadProgram(this.query?.prg ?? programs[0]?.id);
  }

  disconnectedCallback(): void {
    this.stopReplotting();
    this.runner?.terminate();
    this.runner = null;
  }

  // ------------------------------------------------------------- wiring

  private fillProgramList(): void {
    const select = this.querySelector('select');
    if (!select) return;
    select.innerHTML = programs
      .map((p) => `<option value="${p.id}">${p.title}</option>`)
      .join('');
  }

  private wireControls(): void {
    this.querySelector('select')?.addEventListener('change', (event) => {
      const id = (event.target as HTMLSelectElement).value;
      // Through the router, so the address bar carries the program and the page
      // can be linked to and reloaded onto the same one.
      Router.getInstance().navigate(`/?prg=${encodeURIComponent(id)}`);
      this.loadProgram(id);
    });

    this.querySelector('[data-testid="run"]')?.addEventListener('click', () => this.run());
    this.querySelector('[data-testid="stop"]')?.addEventListener('click', () => {
      this.runner?.halt();
    });
    this.querySelector('[data-testid="download"]')?.addEventListener('click', () => {
      this.downloadCsv();
    });

    this.console?.addEventListener('console-input', (event) => {
      this.runner?.sendInput((event as CustomEvent<string>).detail);
    });
  }

  private loadProgram(id: string | undefined): void {
    const program = findProgram(id) ?? programs[0];
    if (!program) return;

    const select = this.querySelector('select');
    if (select) select.value = program.id;

    const description = this.querySelector('[data-testid="program-description"]');
    if (description) description.textContent = program.description;

    const editor = this.editor;
    if (editor) editor.value = program.source;

    this.console?.clear();
    this.chart?.show(null);
    this.plot = null;
    this.setStatus('');
    this.refreshButtons();
  }

  // -------------------------------------------------------------- running

  private run(): void {
    const source = this.editor?.value ?? '';
    if (!source.trim() || !this.runner) return;

    this.console?.clear();
    this.chart?.show(null);
    this.plot = null;
    this.running = true;
    this.setStatus('running…');
    this.refreshButtons();

    this.runner.run(source);
    this.startReplotting();
  }

  private finish(): void {
    this.stopReplotting();
    this.running = false;
    this.replot();
    this.setStatus(this.plot ? '' : 'finished — no numeric table to plot');
    this.refreshButtons();
    this.console?.hideInput();
  }

  private startReplotting(): void {
    this.stopReplotting();
    this.replotTimer = setInterval(() => this.replot(), REPLOT_MS);
  }

  private stopReplotting(): void {
    if (this.replotTimer !== null) {
      clearInterval(this.replotTimer);
      this.replotTimer = null;
    }
  }

  private replot(): void {
    const text = this.console?.text ?? '';
    this.plot = extractPlot(text);
    this.chart?.show(this.plot);
    if (!this.running) this.refreshButtons();
  }

  // ---------------------------------------------------------------- chrome

  private setStatus(text: string): void {
    const status = this.querySelector('[data-testid="status"]');
    if (status) status.textContent = text;
  }

  private refreshButtons(): void {
    const run = this.querySelector<HTMLButtonElement>('[data-testid="run"]');
    const stop = this.querySelector<HTMLButtonElement>('[data-testid="stop"]');
    const download = this.querySelector<HTMLButtonElement>('[data-testid="download"]');
    if (run) run.disabled = this.running;
    if (stop) stop.disabled = !this.running;
    if (download) download.disabled = this.plot === null;
  }

  private downloadCsv(): void {
    if (!this.plot) return;
    const id = this.querySelector('select')?.value ?? 'output';
    const blob = new Blob([toCsv(this.plot)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}

if (!customElements.get(BasicWorkbenchComponent.tagName)) {
  customElements.define(BasicWorkbenchComponent.tagName, BasicWorkbenchComponent);
}
