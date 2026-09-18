import { BaseComponent } from '../../core/base-component.ts';
import type { FormFields } from '../../basic/submission.ts';
import type { WorkspaceProgram } from '../../basic/workspace.ts';
import template from './program-form.html?raw';
import style from './program-form.css?raw';

/** What the Submit dialog needs to hand a program to the GitHub form. */
export interface SubmitPlan {
  url: string;
  listing: string;
  listingIncluded: boolean;
  image: { name: string; href: string } | null;
  /** Drop-down values to check on GitHub, which may not prefill them. */
  choices: [string, string][];
}

/**
 * The details of one of the reader's own programs, as an editable form.
 *
 * The fields are the "Add a program" issue form's own, in the same order and
 * under the same names, so what is typed here is what arrives on GitHub. Each
 * edit dispatches `form-change` with the fields; the workbench saves them and
 * sends back the problems the build's rules find, which are shown above the
 * form and keep Submit disabled until there are none.
 */
export class ProgramFormComponent extends BaseComponent {
  static tagName = 'program-form';

  private shownId = '';

  constructor() {
    super(template, style);
  }

  private get idInput(): HTMLInputElement | null {
    return this.querySelector('[data-testid="form-id"]');
  }

  private get dialog(): HTMLDialogElement | null {
    return this.querySelector('[data-testid="submit-dialog"]');
  }

  init(): void {
    const form = this.querySelector('form');
    form?.addEventListener('submit', (event) => event.preventDefault());
    form?.addEventListener('input', (event) => {
      if ((event.target as HTMLElement).dataset.field) this.emit('form-change', this.fields);
    });

    this.idInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.requestRename();
    });
    this.idInput?.addEventListener('change', () => this.requestRename());

    const file = this.querySelector<HTMLInputElement>('[data-testid="form-diagram-file"]');
    file?.addEventListener('change', () => {
      const chosen = file.files?.[0];
      if (chosen) this.emit('form-image', chosen);
      file.value = '';
    });

    const actions: [string, string][] = [
      ['form-diagram-remove', 'form-image-remove'],
      ['form-submit', 'form-submit'],
      ['form-download', 'form-download'],
      ['form-delete', 'form-delete'],
    ];
    for (const [testId, event] of actions) {
      this.querySelector(`[data-testid="${testId}"]`)?.addEventListener('click', () => this.emit(event, null));
    }
    this.querySelector('[data-testid="submit-close"]')?.addEventListener('click', () => this.dialog?.close());
  }

  show(program: WorkspaceProgram): void {
    this.shownId = program.id;
    if (this.idInput) this.idInput.value = program.id;
    this.querySelectorAll<HTMLInputElement>('[data-field]').forEach((el) => {
      el.value = program.fields[el.dataset.field as keyof FormFields] ?? '';
    });
    this.reveal('[data-testid="form-diagram-remove"]', program.imageFile !== null);
    this.showIdError(null);
    this.showMessage(null);
  }

  /** The fields as typed. The id and listing are not among them: the id is a
   *  rename, not an edit, and the listing is the editor's. */
  get fields(): Partial<FormFields> {
    const fields: Partial<FormFields> = {};
    this.querySelectorAll<HTMLInputElement>('[data-field]').forEach((el) => {
      fields[el.dataset.field as keyof FormFields] = el.value.trim();
    });
    return fields;
  }

  setProblems(problems: string[]): void {
    const list = this.querySelector<HTMLElement>('[data-testid="form-problems"]');
    if (list) {
      list.replaceChildren(
        ...problems.map((problem) => {
          const li = document.createElement('li');
          li.textContent = problem;
          return li;
        })
      );
      list.hidden = problems.length === 0;
    }
    const submit = this.querySelector<HTMLButtonElement>('[data-testid="form-submit"]');
    if (submit) submit.disabled = problems.length > 0;
  }

  showIdError(message: string | null): void {
    const error = this.querySelector<HTMLElement>('[data-testid="form-id-error"]');
    if (!error) return;
    error.textContent = message ?? '';
    error.hidden = !message;
    if (message && this.idInput) this.idInput.value = this.shownId;
  }

  showMessage(message: string | null): void {
    const el = this.querySelector<HTMLElement>('[data-testid="form-message"]');
    if (!el) return;
    el.textContent = message ?? '';
    el.hidden = !message;
  }

  openSubmit(plan: SubmitPlan): void {
    const steps = this.querySelector('.steps');
    const open = this.querySelector<HTMLAnchorElement>('[data-testid="submit-open"]');
    if (!steps || !open || !this.dialog) return;

    const items: Node[] = [];
    if (plan.image) {
      const link = document.createElement('a');
      link.href = plan.image.href;
      link.download = plan.image.name;
      link.textContent = plan.image.name;
      items.push(step(['Download ', link, ', then drag it into the ', strong('Diagram image'), ' box. GitHub cannot fill in an attachment from a link.']));
    }
    if (!plan.listingIncluded) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copy it again';
      copy.addEventListener('click', () => void navigator.clipboard?.writeText(plan.listing));
      items.push(step(['The listing is too long to go in the link, so it has been copied to your clipboard. Paste it into ', strong('Listing'), '. ', copy]));
    }
    if (plan.choices.length > 0) {
      const list = document.createElement('ul');
      for (const [label, value] of plan.choices) {
        const li = document.createElement('li');
        li.textContent = `${label}: ${value}`;
        list.append(li);
      }
      items.push(step(['GitHub may not fill in drop-down menus. Check that these are chosen:', list]));
    }
    items.push(step(['Tick the checkbox at the end of the form and press ', strong('Create'), '.']));

    steps.replaceChildren(...items);
    open.href = plan.url;
    this.dialog.showModal();
  }

  private requestRename(): void {
    const next = this.idInput?.value.trim() ?? '';
    if (next && next !== this.shownId) this.emit('form-rename', next);
  }

  private reveal(selector: string, shown: boolean): void {
    const el = this.querySelector<HTMLElement>(selector);
    if (el) el.hidden = !shown;
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}

function strong(text: string): HTMLElement {
  const el = document.createElement('strong');
  el.textContent = text;
  return el;
}

function step(parts: (string | Node)[]): HTMLElement {
  const li = document.createElement('li');
  li.append(...parts);
  return li;
}

if (!customElements.get(ProgramFormComponent.tagName)) {
  customElements.define(ProgramFormComponent.tagName, ProgramFormComponent);
}
