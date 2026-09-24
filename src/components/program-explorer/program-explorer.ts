import { BaseComponent } from '../../core/base-component.ts';
import { filterPrograms, programFiles, type ProgramFile } from '../../basic/program-library.ts';
import { fileUrl, type Program } from '../../basic/programs.ts';
import template from './program-explorer.html?raw';
import style from './program-explorer.css?raw';

/**
 * What a fidelity means, on the row that carries it. Whether a listing is the
 * published one changes what every number on the screen means, so it is never
 * more than a hover away.
 */
export const FIDELITY_EXPLANATION: Record<string, string> = {
  verbatim: 'Transcribed from the source, character for character.',
  corrected: 'Transcribed from the source, with errors in the original fixed — see the notes.',
  adapted: 'The published model, rewritten to run here. Not the published listing.',
  original: 'Written for this repository as a worked example. Not from a published listing.',
};

/**
 * The sidebar's file tree: every program in the archive, and under the one on
 * screen, every file published with it.
 *
 * It owns no navigation. Picking a program dispatches `program-selected` ({id})
 * and picking a file `file-selected` ({path}); the workbench decides what that
 * means. An image is not text, so it is a plain link to the published file
 * rather than something the editor opens.
 */
export class ProgramExplorerComponent extends BaseComponent {
  static tagName = 'program-explorer';

  private programs: Program[] = [];
  private current: { id: string; path: string } | null = null;

  constructor() {
    super(template, style);
  }

  private get input(): HTMLInputElement | null {
    return this.querySelector('[data-testid="library-filter"]');
  }

  init(): void {
    this.input?.addEventListener('input', () => this.refresh());
    this.delegate('click', '.item', (_event, item) => {
      if (item.dataset.id) this.emit('program-selected', { id: item.dataset.id });
    });
    this.delegate('click', 'button.file', (_event, file) => {
      if (file.dataset.path) this.emit('file-selected', { path: file.dataset.path });
    });
  }

  setPrograms(programs: Program[]): void {
    this.programs = programs;
    this.refresh();
  }

  /** The program on screen, and which of its files the editor is showing. */
  setCurrent(id: string, path: string): void {
    this.current = { id, path };
    this.refresh();
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  // Rebuilds the list only. BaseComponent.update() would replace the filter
  // input too, and take the reader's cursor with it on every keystroke.
  private refresh(): void {
    const list = this.querySelector('[data-testid="library-list"]');
    const empty = this.querySelector<HTMLElement>('[data-testid="library-empty"]');
    if (!list) return;

    const shown = filterPrograms(this.programs, this.input?.value ?? '');
    list.replaceChildren(
      ...shown.map((program) => {
        const li = document.createElement('li');
        const current = this.current?.id === program.id;
        li.append(this.row(program, current));
        if (current) li.append(this.files(program));
        return li;
      })
    );
    if (empty) empty.hidden = shown.length > 0 || this.programs.length === 0;
  }

  private row(program: Program, current: boolean): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item';
    button.dataset.id = program.id;
    button.title = `${program.description}\n\n${program.fidelity}: ${FIDELITY_EXPLANATION[program.fidelity] ?? ''}`;
    button.setAttribute('aria-current', String(current));
    button.setAttribute('aria-expanded', String(current));

    const label = document.createElement('span');
    label.className = 'title';
    label.textContent = program.title;
    const tag = document.createElement('span');
    tag.className = 'badge';
    tag.textContent = program.fidelity;
    button.append(label, tag);
    return button;
  }

  private files(program: Program): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'list files';
    list.dataset.testid = 'file-list';
    list.setAttribute('aria-label', `Files of ${program.title}`);
    list.append(
      ...programFiles(program).map((file) => {
        const li = document.createElement('li');
        li.append(file.kind === 'image' ? this.imageLink(file) : this.fileButton(file));
        return li;
      })
    );
    return list;
  }

  private fileButton(file: ProgramFile): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file';
    button.dataset.path = file.path;
    button.title = file.path;
    button.textContent = file.name;
    button.setAttribute('aria-current', String(this.current?.path === file.path));
    return button;
  }

  private imageLink(file: ProgramFile): HTMLElement {
    const a = document.createElement('a');
    a.className = 'file';
    a.href = fileUrl(file.path);
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = `${file.path}, full size in a new tab`;
    a.textContent = `${file.name} ↗`;
    return a;
  }
}

if (!customElements.get(ProgramExplorerComponent.tagName)) {
  customElements.define(ProgramExplorerComponent.tagName, ProgramExplorerComponent);
}
