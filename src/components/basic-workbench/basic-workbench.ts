import { BaseComponent } from '../../core/base-component.ts';
import { bindInternalLinks } from '../../core/internal-links.ts';
import { Runner } from '../../basic/runner.ts';
import { TableReader, toCsv, type Plot } from '../../basic/output.ts';
import { DrawReader } from '../../basic/draw-plot.ts';
import { diagramUrl, fileUrl, findProgram, loadPrograms, type Program } from '../../basic/programs.ts';
import { programFiles, sidebarOpen } from '../../basic/program-library.ts';
import { contributeUrl } from '../../basic/submission.ts';
import template from './basic-workbench.html?raw';
import style from './basic-workbench.css?raw';

import '../code-editor/code-editor.ts';
import '../console-panel/console-panel.ts';
import '../chart-panel/chart-panel.ts';
import '../theme-toggle/theme-toggle.ts';
import '../engine-status/engine-status.ts';
import '../program-explorer/program-explorer.ts';

import type { CodeEditorComponent } from '../code-editor/code-editor.ts';
import type { ConsolePanelComponent } from '../console-panel/console-panel.ts';
import type { ChartPanelComponent } from '../chart-panel/chart-panel.ts';
import type { DrawOp } from '../../basic/interpreter.ts';
import type { ProgramExplorerComponent } from '../program-explorer/program-explorer.ts';

/** How often the chart is redrawn while a program is still running. Often
 *  enough that a long integration visibly draws itself, rarely enough that
 *  redrawing is not the dominant cost. The table itself is read as the output
 *  arrives (TableReader), so a replot costs only the draw. */
const REPLOT_MS = 250;

/** Where Contribute sends a reader. The archive is only checkable if you can
 *  see what changed since it was added, and it grows through its issue form. */
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
  /** Reads the run's output as it arrives, so a replot never re-reads it. */
  private table = new TableReader();
  /** Reads what the run PSETs, for a listing that draws rather than prints. */
  private draws = new DrawReader('');
  /** Whether the run has printed anything, so a drawing listing's points can
   *  stand in the output pane without being mistaken for what it printed. */
  private printed = false;
  private running = false;
  private replotTimer: ReturnType<typeof setInterval> | null = null;

  /** The program on screen. */
  private current: Program | null = null;
  /** Its listing as the reader has it, edits included, whichever file the
   *  editor is showing. Run always runs this, never a sidecar. */
  private listing = '';
  /** The file the editor is showing, by its path in programs/. */
  private openPath = '';
  /** Counts file opens, so a slow fetch cannot land over a later click. */
  private opening = 0;
  /** Published files never change under a loaded page, so each is fetched once. */
  private readonly texts = new Map<string, Promise<string>>();

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

  private get explorer(): ProgramExplorerComponent | null {
    return this.querySelector('program-explorer');
  }

  private readonly onBreakpoint = (): void => this.setSidebar(this.sidebarDefault());

  init(): void {
    bindInternalLinks(this);
    const contribute = this.querySelector<HTMLAnchorElement>('[data-testid="contribute"]');
    if (contribute) contribute.href = contributeUrl(REPOSITORY_URL);

    this.runner = new Runner({
      onOutput: (text) => this.print(text),
      onInputRequest: () => this.console?.askForInput(),
      onDraw: (ops) => this.draw(ops),
      onDone: (canContinue, resumeLine) => this.finish(canContinue, resumeLine),
      onError: (message) => {
        this.print(`\n?${message}\n`);
        this.finish(false);
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
        this.explorer?.setPrograms(programs);
        this.loadProgram(this.query?.prg ?? programs[0]?.id, this.query?.file);
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

  private wireControls(): void {
    this.addEventListener('program-selected', (event) => {
      this.selectProgram((event as CustomEvent<{ id: string }>).detail.id);
      // On a narrow screen the sidebar is covering the program just picked.
      if (NARROW.matches) this.setSidebar(false);
    });
    this.addEventListener('file-selected', (event) => {
      const { id, path } = (event as CustomEvent<{ id: string; path: string }>).detail;
      // A work's source.json belongs to every model in it: opened from any of
      // them, it stays with the program already on screen.
      const current = this.current;
      if (current && programFiles(current).some((f) => f.path === path)) this.selectFile(path);
      else this.selectProgram(id, path);
      if (NARROW.matches) this.setSidebar(false);
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
    this.querySelector('[data-testid="continue"]')?.addEventListener('click', () => this.cont());
    this.querySelector('[data-testid="download"]')?.addEventListener('click', () => {
      this.downloadCsv();
    });

    this.console?.addEventListener('console-input', (event) => {
      const value = (event as CustomEvent<string>).detail;
      // The console has echoed the answer into the transcript; the table is
      // read from the same transcript, so it sees the echo too.
      this.table.push(value + '\n');
      this.runner?.sendInput(value);
    });
  }

  /** The diagram above the plot, from a URL or not at all. */
  private showDiagram(
    diagram: { url: string; caption: string; figure?: string } | null
  ): void {
    const pane = this.querySelector<HTMLElement>('[data-testid="diagram-pane"]');
    const link = pane?.querySelector('a');
    const image = pane?.querySelector('img');
    const figure = pane?.querySelector('.figure-ref');
    if (!pane || !link || !image) return;

    pane.hidden = diagram === null;
    if (!diagram) {
      image.removeAttribute('src');
      return;
    }
    image.src = diagram.url;
    image.alt = diagram.caption;
    link.href = diagram.url;
    if (figure) figure.textContent = diagram.figure ?? '';
  }

  /**
   * Opens a program in place, and records it in the address bar so the page
   * can be linked to, reloaded, and gone back through. Not through the router:
   * navigate() builds a new workbench, which would take the explorer's open
   * folders, its filter and the last run with it. Back and Forward still go
   * through the router, which rebuilds from the address — that is a new page.
   */
  private selectProgram(id: string, path?: string): void {
    const program = findProgram(this.programs, id);
    history.pushState(history.state, '', this.address(id, program && path !== program.file ? path : undefined));
    this.loadProgram(id, path);
  }

  private address(id: string, path?: string): string {
    const query = new URLSearchParams({ prg: id });
    if (path) query.set('file', path);
    return `${location.pathname}?${query}`;
  }

  private loadProgram(id: string | undefined, path?: string): void {
    const program = findProgram(this.programs, id) ?? this.programs[0];
    if (!program) return;
    this.current = program;
    this.listing = program.listing;
    this.openPath = '';

    const url = diagramUrl(program);
    this.showDiagram(
      url && program.diagram
        ? { url, caption: program.diagram.caption, figure: program.diagram.figure }
        : null
    );

    void this.openFile(path ?? program.file);
    this.resetRun();
  }

  /**
   * Another file of the same program. The address bar is replaced rather than
   * pushed, as a tab switch is in an editor: Back leaves the program, not the file.
   */
  private selectFile(path: string): void {
    const program = this.current;
    if (!program) return;
    history.replaceState(history.state, '', this.address(program.id, path !== program.file ? path : undefined));
    void this.openFile(path);
  }

  private async openFile(path: string): Promise<void> {
    const program = this.current;
    const editor = this.editor;
    if (!program || !editor) return;
    // Anything that is not text, or not this program's, opens the listing.
    const file =
      programFiles(program).find((f) => f.path === path && f.kind !== 'image') ??
      programFiles(program)[0];
    // Leaving the listing: keep what the reader typed, for Run and for coming back.
    if (this.openPath === program.file) this.listing = editor.value;

    const ticket = ++this.opening;
    let text: string;
    try {
      text = file.kind === 'basic' ? this.listing : await this.fetchText(file.path);
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : String(e));
      return;
    }
    if (ticket !== this.opening || this.current !== program) return;

    this.openPath = file.path;
    editor.open(text, file.kind === 'basic' ? 'basic' : 'json');
    this.setFilename(file.path);
    this.explorer?.setCurrent(program.id, file.path);
  }

  private fetchText(path: string): Promise<string> {
    let text = this.texts.get(path);
    if (!text) {
      text = fetch(fileUrl(path)).then((response) => {
        if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status})`);
        return response.text();
      });
      // A failure is not cached: the next click should try again.
      text.catch(() => this.texts.delete(path));
      this.texts.set(path, text);
    }
    return text;
  }

  private setFilename(name: string): void {
    const filename = this.querySelector('[data-testid="editor-filename"]');
    if (filename) filename.textContent = name;
  }

  private resetRun(): void {
    this.console?.clear();
    this.chart?.show(null);
    this.plot = null;
    this.table = new TableReader();
    this.draws = new DrawReader('');
    this.printed = false;
    this.setContinue(false);
    this.setStatus('');
    this.refreshButtons();
  }

  // -------------------------------------------------------------- running

  /** The listing to run: the editor, if it is showing the listing, else the
   *  copy kept when the reader opened another file. */
  private source(): string {
    if (this.current && this.openPath === this.current.file) return this.editor?.value ?? '';
    return this.listing;
  }

  private run(): void {
    const source = this.source();
    if (!source.trim() || !this.runner) return;

    this.console?.clear();
    this.chart?.show(null);
    this.plot = null;
    this.table = new TableReader();
    this.draws = new DrawReader(source);
    this.printed = false;
    this.setContinue(false);
    this.running = true;
    this.setStatus('running…');
    this.refreshButtons();

    this.runner.run(source);
    this.startReplotting();
  }

  private print(text: string): void {
    if (!this.printed && text !== '') {
      // The points shown in place of output at the last stop are not output.
      if (this.draws.plot) this.console?.clear();
      this.printed = true;
    }
    this.console?.append(text);
    this.table.push(text);
  }

  /** CONT: carry on in the program that stopped at END or STOP. */
  private cont(): void {
    if (!this.runner) return;
    this.setContinue(false);
    // CONT starts the listing's next experiment: MACROEC's second run restarts its
    // clock, so its points are a series of their own.
    this.draws.nextRun();
    this.running = true;
    this.setStatus('running…');
    this.refreshButtons();
    this.runner.cont();
    this.startReplotting();
  }

  private finish(canContinue: boolean, resumeLine = 0): void {
    this.stopReplotting();
    // Only once the output is complete: after END, CONT may still finish the
    // line the program was part-way through printing.
    if (!canContinue) this.table.end();
    this.running = false;
    this.replot();
    // A listing that only draws printed nothing: its points are its table.
    if (!this.printed && this.draws.plot) {
      this.console?.clear();
      this.console?.append(
        'The program printed nothing. These are the points it plotted with PSET, also in the CSV:\n\n' +
          this.draws.table() +
          '\n'
      );
    }
    this.setStatus(
      canContinue
        ? this.stoppedAt(resumeLine)
        : this.plot
          ? ''
          : 'finished — no numeric table to plot'
    );
    this.setContinue(canContinue);
    this.refreshButtons();
    this.console?.hideInput();
  }

  private setContinue(available: boolean): void {
    const button = this.querySelector<HTMLElement>('[data-testid="continue"]');
    if (button) button.hidden = !available;
  }

  private draw(ops: DrawOp[]): void {
    this.draws.push(ops);
  }

  /**
   * What stopping at END means, in the listing's words where it has some. The
   * line CONT resumes at is often a REM saying what comes next — MACROEC's 452,
   * "Type CONT to rerun with rewnable resources" — so it is quoted.
   */
  private stoppedAt(resumeLine: number): string {
    if (!resumeLine) return 'stopped — Continue (CONT) runs the rest';
    const text = this.source()
      .split(/\r?\n/)
      .find((l) => new RegExp(`^\\s*${resumeLine}\\b`).test(l));
    const remark = text ? /^\s*\d+\s*(?:REM\b|')\s*(.*)$/i.exec(text)?.[1]?.trim() : undefined;
    return remark
      ? `stopped — CONT resumes at line ${resumeLine}: “${remark}”`
      : `stopped — Continue (CONT) resumes at line ${resumeLine}`;
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
    // A printed table if there is one; otherwise what the listing drew.
    this.plot = this.table.plot ?? this.draws.plot;
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
    // A model's id is its path (odum_simulation_1989/tank); a filename cannot
    // carry the slash.
    const id = this.current?.id.replaceAll('/', '_') ?? 'output';
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
