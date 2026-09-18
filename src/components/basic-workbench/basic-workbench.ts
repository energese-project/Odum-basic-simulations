import { BaseComponent } from '../../core/base-component.ts';
import { bindInternalLinks } from '../../core/internal-links.ts';
import { Router } from '../../core/router/router.ts';
import { Runner } from '../../basic/runner.ts';
import { extractPlot, toCsv, type Plot } from '../../basic/output.ts';
import { diagramUrl, findProgram, loadPrograms, type Program } from '../../basic/programs.ts';
import { sidebarOpen } from '../../basic/program-library.ts';
import { issueFormUrl, type FormFields } from '../../basic/submission.ts';
import { Workspace, type WorkspaceProgram } from '../../basic/workspace.ts';
import { openWorkspaceStore } from '../../workspace/opfs-store.ts';
import template from './basic-workbench.html?raw';
import style from './basic-workbench.css?raw';

import '../code-editor/code-editor.ts';
import '../console-panel/console-panel.ts';
import '../chart-panel/chart-panel.ts';
import '../theme-toggle/theme-toggle.ts';
import '../program-meta/program-meta.ts';
import '../program-explorer/program-explorer.ts';
import '../program-form/program-form.ts';

import type { CodeEditorComponent } from '../code-editor/code-editor.ts';
import type { ConsolePanelComponent } from '../console-panel/console-panel.ts';
import type { ChartPanelComponent } from '../chart-panel/chart-panel.ts';
import type { ProgramMetaComponent } from '../program-meta/program-meta.ts';
import type {
  ProgramExplorerComponent,
  ProgramRef,
} from '../program-explorer/program-explorer.ts';
import type { ProgramFormComponent } from '../program-form/program-form.ts';

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

/** How long typing pauses before the workspace writes to disk. Short enough
 *  that closing the tab loses nothing worth minding. */
const SAVE_MS = 300;

/** The top-bar picker's values for the reader's own programs. Archive ids are
 *  lowercase-kebab and can never contain a colon, so the two cannot collide. */
const MINE = 'my:';

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

  private get explorer(): ProgramExplorerComponent | null {
    return this.querySelector('program-explorer');
  }

  private get form(): ProgramFormComponent | null {
    return this.querySelector('program-form');
  }

  private workspace: Workspace | null = null;
  /** The program on screen. Workspace edits are saved against this. */
  private current: ProgramRef | null = null;
  private currentWorkspace: WorkspaceProgram | null = null;
  private pendingSave: (() => Promise<void>) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private diagramObjectUrl: string | null = null;

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
    void Promise.all([loadPrograms(), openWorkspaceStore()])
      .then(async ([programs, store]) => {
        this.programs = programs;
        this.explorer?.setPrograms(programs);
        this.workspace = store ? new Workspace(store, programs.map((p) => p.id)) : null;
        this.meta?.setCopyAvailable(this.workspace !== null);
        await this.refreshWorkspace();

        const mine = this.query?.my;
        if (mine && this.workspace && (await this.workspaceHas(mine))) {
          await this.openWorkspaceProgram(mine);
        } else {
          this.loadProgram(this.query?.prg ?? programs[0]?.id);
        }
      })
      .catch((error: unknown) => {
        this.setStatus(error instanceof Error ? error.message : String(error));
      });
  }

  disconnectedCallback(): void {
    void this.flushSave();
    if (this.diagramObjectUrl) URL.revokeObjectURL(this.diagramObjectUrl);
    NARROW.removeEventListener('change', this.onBreakpoint);
    this.stopReplotting();
    this.runner?.terminate();
    this.runner = null;
  }

  // ------------------------------------------------------------- wiring

  private fillProgramList(mine: { id: string; title: string }[] = []): void {
    const select = this.querySelector('select');
    if (!select) return;
    const value = select.value;
    const archive = document.createElement('optgroup');
    archive.label = 'Archive';
    archive.append(...this.programs.map((p) => new Option(p.title, p.id)));
    const groups: HTMLElement[] = [archive];
    if (mine.length > 0) {
      const own = document.createElement('optgroup');
      own.label = 'My programs';
      own.append(...mine.map((p) => new Option(p.title, `${MINE}${p.id}`)));
      groups.push(own);
    }
    select.replaceChildren(...groups);
    select.value = value;
  }

  private wireControls(): void {
    this.querySelector('select')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (value.startsWith(MINE)) void this.selectWorkspaceProgram(value.slice(MINE.length));
      else this.selectProgram(value);
    });
    this.addEventListener('program-selected', (event) => {
      const { kind, id } = (event as CustomEvent<ProgramRef>).detail;
      if (kind === 'workspace') void this.selectWorkspaceProgram(id);
      else this.selectProgram(id);
      // On a narrow screen the sidebar is covering the program just picked.
      if (NARROW.matches) this.setSidebar(false);
    });
    this.addEventListener('tag-selected', (event) => {
      this.explorer?.setFilter((event as CustomEvent<string>).detail);
    });
    this.wireWorkspace();

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

  private selectProgram(id: string): void {
    // Through the router, so the address bar carries the program and the page
    // can be linked to and reloaded onto the same one.
    Router.getInstance().navigate(`/?prg=${encodeURIComponent(id)}`);
    this.loadProgram(id);
  }

  private loadProgram(id: string | undefined): void {
    const program = findProgram(this.programs, id) ?? this.programs[0];
    if (!program) return;
    void this.flushSave();
    this.current = { kind: 'archive', id: program.id };
    this.currentWorkspace = null;

    const select = this.querySelector('select');
    if (select) select.value = program.id;

    const url = diagramUrl(program);
    this.showDiagram(
      url && program.diagram
        ? { url, caption: program.diagram.caption, figure: program.diagram.figure }
        : null
    );

    this.setFilename(program.file);
    this.explorer?.setCurrent(this.current);

    const editor = this.editor;
    if (editor) editor.value = program.listing;

    this.meta?.show(program, REPOSITORY_URL);
    this.showDetails('archive');
    this.resetRun();
  }

  private setFilename(name: string): void {
    const filename = this.querySelector('[data-testid="editor-filename"]');
    if (filename) filename.textContent = name;
  }

  private showDetails(kind: 'archive' | 'workspace'): void {
    if (this.meta) this.meta.hidden = kind !== 'archive';
    if (this.form) this.form.hidden = kind !== 'workspace';
  }

  private resetRun(): void {
    this.console?.clear();
    this.chart?.show(null);
    this.plot = null;
    this.setStatus('');
    this.refreshButtons();
  }

  // -------------------------------------------------------- my programs

  private wireWorkspace(): void {
    this.addEventListener('workspace-new', () => void this.newWorkspaceProgram());
    this.addEventListener('copy-to-workspace', () => void this.copyToWorkspace());

    this.addEventListener('file-selected', (event) => {
      const { id, file } = (event as CustomEvent<{ id: string; file: string }>).detail;
      void this.selectWorkspaceProgram(id).then(() => {
        if (file.endsWith('.bas')) this.editor?.focus();
        else if (file.endsWith('.json')) this.form?.scrollIntoView({ block: 'nearest' });
        else this.querySelector('[data-testid="diagram-pane"]')?.scrollIntoView({ block: 'nearest' });
      });
    });

    this.addEventListener('editor-change', () => {
      const program = this.currentWorkspace;
      if (!program) return;
      this.scheduleSave(async () => {
        await this.workspace?.saveListing(program.id, this.editor?.value ?? '');
        await this.refreshProblems();
      });
    });

    this.addEventListener('form-change', (event) => {
      const program = this.currentWorkspace;
      if (!program) return;
      program.fields = { ...program.fields, ...(event as CustomEvent<Partial<FormFields>>).detail };
      const fields = program.fields;
      this.scheduleSave(async () => {
        await this.workspace?.saveFields(program.id, fields);
        await this.refreshWorkspace();
        await this.refreshProblems();
      });
    });

    this.addEventListener('form-rename', (event) => {
      void this.renameWorkspaceProgram((event as CustomEvent<string>).detail);
    });
    this.addEventListener('form-image', (event) => {
      void this.attachImage((event as CustomEvent<File>).detail);
    });
    this.addEventListener('form-image-remove', () => void this.detachImage());
    this.addEventListener('form-submit', () => void this.submitWorkspaceProgram());
    this.addEventListener('form-download', () => void this.downloadWorkspaceProgram());
    this.addEventListener('form-delete', () => void this.deleteWorkspaceProgram());
  }

  private scheduleSave(save: () => Promise<void>): void {
    this.pendingSave = save;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), SAVE_MS);
  }

  /** Write whatever is waiting now — before switching, renaming or leaving. */
  private async flushSave(): Promise<void> {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const save = this.pendingSave;
    this.pendingSave = null;
    await save?.();
  }

  private async refreshWorkspace(): Promise<void> {
    const entries = this.workspace ? await this.workspace.list() : null;
    this.explorer?.setWorkspace(entries);
    this.fillProgramList(entries ?? []);
  }

  private async refreshProblems(): Promise<void> {
    const program = this.currentWorkspace;
    if (!program || !this.workspace) return;
    this.form?.setProblems(await this.workspace.check(program.id));
  }

  private async workspaceHas(id: string): Promise<boolean> {
    return (await this.workspace?.list())?.some((p) => p.id === id) ?? false;
  }

  private async selectWorkspaceProgram(id: string): Promise<void> {
    if (this.current?.kind === 'workspace' && this.current.id === id) return;
    Router.getInstance().navigate(`/?my=${encodeURIComponent(id)}`);
    await this.openWorkspaceProgram(id);
  }

  private async openWorkspaceProgram(id: string): Promise<void> {
    if (!this.workspace) return;
    await this.flushSave();
    const program = await this.workspace.open(id);
    this.current = { kind: 'workspace', id };
    this.currentWorkspace = program;

    const select = this.querySelector('select');
    if (select) select.value = `${MINE}${id}`;
    this.setFilename(`${id}.bas`);
    this.explorer?.setCurrent(this.current);
    if (this.editor) this.editor.value = program.listing;
    this.showWorkspaceDiagram(program);

    this.form?.show(program);
    this.showDetails('workspace');
    await this.refreshProblems();
    this.resetRun();
  }

  private showWorkspaceDiagram(program: WorkspaceProgram): void {
    if (this.diagramObjectUrl) URL.revokeObjectURL(this.diagramObjectUrl);
    this.diagramObjectUrl = null;
    if (!program.image || !program.imageFile) {
      this.showDiagram(null);
      return;
    }
    this.diagramObjectUrl = URL.createObjectURL(new Blob([program.image as Uint8Array<ArrayBuffer>]));
    this.showDiagram({
      url: this.diagramObjectUrl,
      caption: program.fields.diagramCaption || 'The diagram for this program',
      figure: program.fields.diagramFigure || undefined,
    });
  }

  private async newWorkspaceProgram(): Promise<void> {
    if (!this.workspace) return;
    await this.flushSave();
    const id = await this.workspace.create();
    await this.refreshWorkspace();
    await this.selectWorkspaceProgram(id);
  }

  private async copyToWorkspace(): Promise<void> {
    const source = this.current?.kind === 'archive' ? findProgram(this.programs, this.current.id) : null;
    if (!source || !this.workspace) return;
    const url = diagramUrl(source);
    const image = url ? new Uint8Array(await (await fetch(url)).arrayBuffer()) : undefined;
    const id = await this.workspace.copyFromArchive(source, image);
    await this.refreshWorkspace();
    await this.selectWorkspaceProgram(id);
  }

  private async renameWorkspaceProgram(to: string): Promise<void> {
    const program = this.currentWorkspace;
    if (!program || !this.workspace) return;
    await this.flushSave();
    try {
      await this.workspace.rename(program.id, to);
    } catch (e) {
      this.form?.showIdError(e instanceof Error ? e.message : String(e));
      return;
    }
    this.current = null;
    await this.refreshWorkspace();
    await this.selectWorkspaceProgram(to);
  }

  private async attachImage(file: File): Promise<void> {
    const program = this.currentWorkspace;
    if (!program || !this.workspace) return;
    await this.flushSave();
    try {
      await this.workspace.saveImage(program.id, new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      this.form?.showMessage(e instanceof Error ? e.message : String(e));
      return;
    }
    await this.reopenWorkspaceProgram();
  }

  private async detachImage(): Promise<void> {
    const program = this.currentWorkspace;
    if (!program || !this.workspace) return;
    await this.flushSave();
    await this.workspace.removeImage(program.id);
    await this.reopenWorkspaceProgram();
  }

  /** After a change to its files: re-read it without losing the editor's place. */
  private async reopenWorkspaceProgram(): Promise<void> {
    const id = this.currentWorkspace?.id;
    if (!id || !this.workspace) return;
    const program = await this.workspace.open(id);
    this.currentWorkspace = program;
    this.showWorkspaceDiagram(program);
    this.form?.show(program);
    await this.refreshWorkspace();
    await this.refreshProblems();
  }

  private async submitWorkspaceProgram(): Promise<void> {
    const program = this.currentWorkspace;
    if (!program || !this.workspace) return;
    await this.flushSave();
    if ((await this.workspace.check(program.id)).length > 0) return;

    const listing = this.editor?.value ?? program.listing;
    const { url, listingIncluded } = issueFormUrl(REPOSITORY_URL, program.fields, listing);
    if (!listingIncluded) {
      try {
        await navigator.clipboard.writeText(listing);
      } catch {
        // Refused; the dialog's "Copy it again" is a user gesture and may succeed.
      }
    }

    const { fields } = program;
    const choices: [string, string][] = [['Fidelity', fields.fidelity]];
    if (fields.sourceType) choices.push(['Source type', fields.sourceType]);
    if (fields.rightsBasis) choices.push(['Diagram rights basis', fields.rightsBasis]);

    this.form?.openSubmit({
      url,
      listing,
      listingIncluded,
      image:
        program.imageFile && this.diagramObjectUrl
          ? { name: program.imageFile, href: this.diagramObjectUrl }
          : null,
      choices,
    });
  }

  private async downloadWorkspaceProgram(): Promise<void> {
    const program = this.currentWorkspace;
    if (!program || !this.workspace) return;
    await this.flushSave();
    const entry = (await this.workspace.list()).find((p) => p.id === program.id);
    for (const name of entry?.files ?? []) {
      const bytes = await this.workspace.readFile(name);
      if (!bytes) continue;
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  private async deleteWorkspaceProgram(): Promise<void> {
    const program = this.currentWorkspace;
    if (!program || !this.workspace) return;
    if (!confirm(`Delete ${program.id}? Its files are only in this browser, so this cannot be undone.`)) return;
    this.pendingSave = null;
    await this.flushSave();
    await this.workspace.remove(program.id);
    this.currentWorkspace = null;
    await this.refreshWorkspace();
    this.selectProgram(this.programs[0]?.id ?? '');
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
    const id = this.current?.id ?? 'output';
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
