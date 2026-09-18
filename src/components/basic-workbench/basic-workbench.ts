import { BaseComponent } from '../../core/base-component.ts';
import { bindInternalLinks } from '../../core/internal-links.ts';
import { Router } from '../../core/router/router.ts';
import { Runner } from '../../basic/runner.ts';
import { extractPlot, toCsv, type Plot } from '../../basic/output.ts';
import { diagramUrl, findProgram, loadPrograms, type Program } from '../../basic/programs.ts';
import { sidebarOpen } from '../../basic/program-library.ts';
import template from './basic-workbench.html?raw';
import style from './basic-workbench.css?raw';

import '../code-editor/code-editor.ts';
import '../console-panel/console-panel.ts';
import '../chart-panel/chart-panel.ts';
import '../theme-toggle/theme-toggle.ts';
import '../program-meta/program-meta.ts';
import '../program-library/program-library.ts';

import type { CodeEditorComponent } from '../code-editor/code-editor.ts';
import type { ConsolePanelComponent } from '../console-panel/console-panel.ts';
import type { ChartPanelComponent } from '../chart-panel/chart-panel.ts';
import type { ProgramMetaComponent } from '../program-meta/program-meta.ts';
import type { ProgramLibraryComponent } from '../program-library/program-library.ts';

/** How often the chart is re-derived while a program is still running. Often
 *  enough that a long integration visibly draws itself, rarely enough that
 *  re-parsing the transcript is not the dominant cost. */
const REPLOT_MS = 250;

/** Used to link a listing to its history. The archive is only checkable if you
 *  can see what changed since it was added. */
const REPOSITORY_URL = 'https://github.com/energese-project/Odum-basic-simulations';

/** Remembers whether the reader closed the sidebar. Wide screens only — see
 *  sidebarOpen() for why a narrow screen ignores it. */
const SIDEBAR_KEY = 'obs-sidebar';

/** The breakpoint in basic-workbench.css below which the panes stack and the
 *  sidebar becomes a sheet over them. The two must agree. */
const NARROW = window.matchMedia('(max-width: 60rem)');

export class BasicWorkbenchComponent extends BaseComponent {
  static tagName = 'basic-workbench';

  /** Set by the router from the query string. */
  query?: Record<string, string>;

  private programs: Program[] = [];
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

  private get meta(): ProgramMetaComponent | null {
    return this.querySelector('program-meta');
  }

  private get library(): ProgramLibraryComponent | null {
    return this.querySelector('program-library');
  }

  private readonly onBreakpoint = (): void => this.setSidebar(this.sidebarDefault());

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

    this.wireControls();
    this.setSidebar(this.sidebarDefault());
    NARROW.addEventListener('change', this.onBreakpoint);

    // The catalog is fetched, not bundled — see programs.ts. Everything that
    // depends on it waits; everything that does not is already wired above, so
    // the shell is on screen while this is in flight.
    void loadPrograms()
      .then((programs) => {
        this.programs = programs;
        this.fillProgramList();
        this.library?.setPrograms(programs);
        this.loadProgram(this.query?.prg ?? programs[0]?.id);
      })
      .catch((error: unknown) => {
        this.setStatus(error instanceof Error ? error.message : String(error));
      });
  }

  disconnectedCallback(): void {
    NARROW.removeEventListener('change', this.onBreakpoint);
    this.stopReplotting();
    this.runner?.terminate();
    this.runner = null;
  }

  // ------------------------------------------------------------- wiring

  private fillProgramList(): void {
    const select = this.querySelector('select');
    if (!select) return;
    select.replaceChildren(
      ...this.programs.map((p) => new Option(p.title, p.id))
    );
  }

  private wireControls(): void {
    this.querySelector('select')?.addEventListener('change', (event) => {
      this.selectProgram((event.target as HTMLSelectElement).value);
    });
    this.addEventListener('program-selected', (event) => {
      this.selectProgram((event as CustomEvent<string>).detail);
      // On a narrow screen the sidebar is covering the program just picked.
      if (NARROW.matches) this.setSidebar(false);
    });
    this.addEventListener('tag-selected', (event) => {
      this.library?.setFilter((event as CustomEvent<string>).detail);
    });

    this.querySelector('[data-testid="sidebar-toggle"]')?.addEventListener('click', () => {
      this.setSidebar(!this.isSidebarOpen(), { remember: true });
    });
    this.querySelector('[data-testid="sidebar-scrim"]')?.addEventListener('click', () => {
      this.setSidebar(false);
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

  private showDiagram(program: Program): void {
    const pane = this.querySelector<HTMLElement>('[data-testid="diagram-pane"]');
    const link = pane?.querySelector('a');
    const image = pane?.querySelector('img');
    const figure = pane?.querySelector('.figure-ref');
    if (!pane || !link || !image) return;

    const url = diagramUrl(program);
    pane.hidden = !url || !program.diagram;
    if (!url || !program.diagram) {
      image.removeAttribute('src');
      return;
    }
    image.src = url;
    image.alt = program.diagram.caption;
    link.href = url;
    if (figure) figure.textContent = program.diagram.figure ?? '';
  }

  private selectProgram(id: string): void {
    // Through the router, so the address bar carries the program and the page
    // can be linked to and reloaded onto the same one.
    Router.getInstance().navigate(`/?prg=${encodeURIComponent(id)}`);
    this.loadProgram(id);
  }

  private loadProgram(id: string | undefined): void {
    const program = findProgram(this.programs, id) ?? this.programs[0];
    if (!program) return;

    const select = this.querySelector('select');
    if (select) select.value = program.id;

    this.showDiagram(program);

    const filename = this.querySelector('[data-testid="editor-filename"]');
    if (filename) filename.textContent = program.file;
    this.library?.setCurrent(program.id);

    const editor = this.editor;
    if (editor) editor.value = program.listing;

    this.meta?.show(program, REPOSITORY_URL);

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

  private sidebarDefault(): boolean {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(SIDEBAR_KEY);
    } catch {
      // Private browsing: fall back to the default for this screen width.
    }
    return sidebarOpen(stored, !NARROW.matches);
  }

  private isSidebarOpen(): boolean {
    return this.querySelector<HTMLElement>('.shell')?.dataset.sidebar === 'open';
  }

  private setSidebar(open: boolean, { remember = false } = {}): void {
    const shell = this.querySelector<HTMLElement>('.shell');
    if (shell) shell.dataset.sidebar = open ? 'open' : 'closed';
    this.querySelector('[data-testid="sidebar-toggle"]')?.setAttribute(
      'aria-expanded',
      String(open)
    );
    if (!remember || NARROW.matches) return;
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed');
    } catch {
      // Private browsing: the choice holds until the page is left.
    }
  }

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
