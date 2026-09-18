import { BaseComponent } from '../../core/base-component.ts';
import { filterPrograms } from '../../basic/program-library.ts';
import type { Program } from '../../basic/programs.ts';
import template from './program-library.html?raw';
import style from './program-library.css?raw';

/**
 * The program list in the sidebar, with a filter over it.
 *
 * It owns no navigation: picking a program dispatches `program-selected` with
 * the id, and the workbench decides what that means — the same path the top-bar
 * picker takes, so the two can never disagree about which program is loaded.
 */
export class ProgramLibraryComponent extends BaseComponent {
  static tagName = 'program-library';

  private programs: Program[] = [];
  private current: string | null = null;

  constructor() {
    super(template, style);
  }

  private get input(): HTMLInputElement | null {
    return this.querySelector('[data-testid="library-filter"]');
  }

  init(): void {
    this.input?.addEventListener('input', () => this.refresh());
    this.delegate('click', '.item', (_event, item) => {
      const id = item.dataset.id;
      if (id) {
        this.dispatchEvent(new CustomEvent<string>('program-selected', { detail: id, bubbles: true }));
      }
    });
  }

  setPrograms(programs: Program[]): void {
    this.programs = programs;
    this.refresh();
  }

  setCurrent(id: string): void {
    this.current = id;
    this.querySelectorAll<HTMLElement>('.item').forEach((item) => {
      item.setAttribute('aria-current', String(item.dataset.id === id));
    });
  }

  setFilter(query: string): void {
    if (this.input) this.input.value = query;
    this.refresh();
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
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'item';
        button.dataset.id = program.id;
        button.title = program.description;
        button.setAttribute('aria-current', String(program.id === this.current));

        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = program.title;
        const fidelity = document.createElement('span');
        fidelity.className = 'fidelity';
        fidelity.textContent = program.fidelity;

        button.append(title, fidelity);
        li.append(button);
        return li;
      })
    );
    if (empty) empty.hidden = shown.length > 0 || this.programs.length === 0;
  }
}

if (!customElements.get(ProgramLibraryComponent.tagName)) {
  customElements.define(ProgramLibraryComponent.tagName, ProgramLibraryComponent);
}
