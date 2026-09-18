import { BaseComponent } from '../../core/base-component.ts';
import { filterPrograms } from '../../basic/program-library.ts';
import type { WorkspaceEntry } from '../../basic/workspace.ts';
import type { Program } from '../../basic/programs.ts';
import template from './program-explorer.html?raw';
import style from './program-explorer.css?raw';

export type ProgramKind = 'archive' | 'workspace';

export interface ProgramRef {
  kind: ProgramKind;
  id: string;
}

/**
 * The sidebar's file tree: the archive, read-only and fetched fresh on every
 * load, and "My programs", the reader's own files in this browser.
 *
 * It owns no navigation. Picking something dispatches `program-selected`
 * ({kind, id}), `file-selected` ({id, file}) or `workspace-new`, and the
 * workbench decides what that means — the same path the top-bar picker takes,
 * so the two can never disagree about which program is loaded.
 *
 * Only My programs lists files: they are the reader's to edit. An archive
 * program's files are linked from its details instead.
 */
export class ProgramExplorerComponent extends BaseComponent {
  static tagName = 'program-explorer';

  private programs: Program[] = [];
  private workspace: WorkspaceEntry[] | null = [];
  private current: ProgramRef | null = null;

  constructor() {
    super(template, style);
  }

  private get input(): HTMLInputElement | null {
    return this.querySelector('[data-testid="library-filter"]');
  }

  init(): void {
    this.input?.addEventListener('input', () => this.refresh());
    this.delegate('click', '.item', (_event, item) => {
      const { id, kind } = item.dataset;
      if (id && kind) this.emit('program-selected', { kind: kind as ProgramKind, id });
    });
    this.delegate('click', '.file', (_event, file) => {
      const { id, file: name } = file.dataset;
      if (id && name) this.emit('file-selected', { id, file: name });
    });
    this.querySelector('[data-testid="workspace-new"]')?.addEventListener('click', (event) => {
      // The button sits in the <summary>; without this it would also fold the root.
      event.preventDefault();
      this.emit('workspace-new', null);
    });
  }

  setPrograms(programs: Program[]): void {
    this.programs = programs;
    this.refresh();
  }

  /** null when this browser cannot keep files for the site at all. */
  setWorkspace(entries: WorkspaceEntry[] | null): void {
    this.workspace = entries;
    this.refresh();
  }

  setCurrent(ref: ProgramRef): void {
    this.current = ref;
    this.refresh();
  }

  setFilter(query: string): void {
    if (this.input) this.input.value = query;
    this.refresh();
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  // Rebuilds the lists only. BaseComponent.update() would replace the filter
  // input too, and take the reader's cursor with it on every keystroke.
  private refresh(): void {
    const query = this.input?.value ?? '';
    this.refreshArchive(query);
    this.refreshWorkspace(query);
  }

  private refreshArchive(query: string): void {
    const list = this.querySelector('[data-testid="library-list"]');
    const empty = this.querySelector<HTMLElement>('[data-testid="library-empty"]');
    if (!list) return;

    const shown = filterPrograms(this.programs, query);
    list.replaceChildren(
      ...shown.map((program) => {
        const li = document.createElement('li');
        li.append(this.row('archive', program.id, program.title, program.fidelity, program.description));
        return li;
      })
    );
    if (empty) empty.hidden = shown.length > 0 || this.programs.length === 0;
  }

  private refreshWorkspace(query: string): void {
    const list = this.querySelector('[data-testid="workspace-list"]');
    const empty = this.querySelector<HTMLElement>('[data-testid="workspace-empty"]');
    const unavailable = this.querySelector<HTMLElement>('[data-testid="workspace-unavailable"]');
    const add = this.querySelector<HTMLElement>('[data-testid="workspace-new"]');
    if (!list) return;

    if (unavailable) unavailable.hidden = this.workspace !== null;
    if (add) add.hidden = this.workspace === null;
    const entries = this.workspace ?? [];
    if (empty) empty.hidden = this.workspace === null || entries.length > 0;

    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = entries.filter((e) =>
      words.every((w) => `${e.id} ${e.title}`.toLowerCase().includes(w))
    );

    list.replaceChildren(
      ...shown.map((entry) => {
        const li = document.createElement('li');
        li.append(this.row('workspace', entry.id, entry.title, 'draft', entry.id));
        if (this.isCurrent('workspace', entry.id)) {
          const files = document.createElement('ul');
          files.className = 'list';
          files.setAttribute('aria-label', `Files of ${entry.title}`);
          for (const name of entry.files) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file';
            button.dataset.id = entry.id;
            button.dataset.file = name;
            button.textContent = name;
            item.append(button);
            files.append(item);
          }
          li.append(files);
        }
        return li;
      })
    );
  }

  private isCurrent(kind: ProgramKind, id: string): boolean {
    return this.current?.kind === kind && this.current.id === id;
  }

  private row(kind: ProgramKind, id: string, title: string, badge: string, hint: string): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item';
    button.dataset.id = id;
    button.dataset.kind = kind;
    button.title = hint;
    button.setAttribute('aria-current', String(this.isCurrent(kind, id)));

    const label = document.createElement('span');
    label.className = 'title';
    label.textContent = title;
    const tag = document.createElement('span');
    tag.className = 'badge';
    tag.textContent = badge;
    button.append(label, tag);
    return button;
  }
}

if (!customElements.get(ProgramExplorerComponent.tagName)) {
  customElements.define(ProgramExplorerComponent.tagName, ProgramExplorerComponent);
}
