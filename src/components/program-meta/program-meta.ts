import { BaseComponent } from '../../core/base-component.ts';
import { formatCitation, toBibtex } from '../../basic/program-catalog.ts';
import { diagramUrl, programUrl, type Program } from '../../basic/programs.ts';
import template from './program-meta.html?raw';
import style from './program-meta.css?raw';

/**
 * Everything the sidecar says about a listing, in the sidebar under the library.
 *
 * The archive is only worth having if a reader can check a program against its
 * source, so the whole record is shown, not a summary of it. The fidelity comes
 * first because it changes what the rest of the panel means: a verbatim
 * transcription and a model rewritten to run here answer different questions,
 * and nobody should have to infer which they are reading. It is also repeated
 * in the top bar, so closing the sidebar never hides it.
 *
 * Clicking a tag dispatches `tag-selected`; the workbench turns that into a
 * library filter.
 */

export const FIDELITY_EXPLANATION: Record<string, string> = {
  verbatim: 'Transcribed from the source, character for character.',
  corrected: 'Transcribed from the source, with errors in the original fixed — see the note.',
  adapted: 'The published model, rewritten to run here. Not the published listing.',
  original: 'Written for this repository as a worked example. Not from a published listing.',
};

const RIGHTS_LABEL: Record<string, string> = {
  'own-work': 'own work',
  'public-domain': 'public domain',
  licensed: 'licensed',
  permission: 'by permission',
  'fair-use': 'fair use / fair dealing',
};

export class ProgramMetaComponent extends BaseComponent {
  static tagName = 'program-meta';

  constructor() {
    super(template, style);
  }

  init(): void {
    this.delegate('click', '.tag', (_event, tag) => {
      this.dispatchEvent(
        new CustomEvent<string>('tag-selected', { detail: tag.textContent ?? '', bubbles: true })
      );
    });
    this.querySelector('[data-testid="copy-bibtex"]')?.addEventListener('click', () => {
      void this.copyBibtex();
    });
  }

  show(program: Program, repositoryUrl: string): void {
    this.text('meta-title', program.title);
    this.text('meta-description', program.description);
    this.text('fidelity-explanation', FIDELITY_EXPLANATION[program.fidelity] ?? '');

    const badge = this.querySelector<HTMLElement>('[data-testid="fidelity-badge"]');
    if (badge) {
      badge.textContent = program.fidelity;
      badge.dataset.fidelity = program.fidelity;
    }

    this.text(
      'citation',
      program.source ? formatCitation(program.source) : 'None. Not from a published listing.'
    );
    const bibtexBlock = this.querySelector<HTMLDetailsElement>('[data-testid="bibtex-block"]');
    if (bibtexBlock) bibtexBlock.hidden = !program.source;
    this.text('bibtex', program.source ? toBibtex(program.id, program.source) : '');

    const diagram = program.diagram;
    this.reveal('[data-testid="meta-diagram"]', Boolean(diagram));
    this.text('diagram-caption', diagram?.caption ?? '');
    this.text('diagram-figure', diagram?.figure ?? '');
    this.reveal('[data-testid="diagram-figure"]', Boolean(diagram?.figure));
    this.text('diagram-basis', diagram ? RIGHTS_LABEL[diagram.rights.basis] : '');
    this.text('diagram-rights', diagram?.rights.statement ?? '');

    this.text('meta-notes', program.notes ?? '');
    this.reveal('.notes-field', Boolean(program.notes));

    const tags = this.querySelector('[data-testid="meta-tags"]');
    tags?.replaceChildren(
      ...program.tags.map((name) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tag';
        button.title = `Show every program tagged ${name}`;
        button.textContent = name;
        li.append(button);
        return li;
      })
    );
    this.reveal('.tags-field', program.tags.length > 0);

    const links = this.querySelector<HTMLElement>('[data-testid="meta-links"]');
    if (!links) return;
    links.replaceChildren(
      ...this.linksFor(program, repositoryUrl).map(({ label, href }) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = href;
        a.textContent = label;
        // Every link here leaves the application.
        a.rel = 'noopener';
        a.target = '_blank';
        li.append(a);
        return li;
      })
    );
  }

  private text(testId: string, value: string): void {
    const el = this.querySelector(`[data-testid="${testId}"]`);
    if (el) el.textContent = value;
  }

  private reveal(selector: string, shown: boolean): void {
    const el = this.querySelector<HTMLElement>(selector);
    if (el) el.hidden = !shown;
  }

  private async copyBibtex(): Promise<void> {
    const pre = this.querySelector('[data-testid="bibtex"]');
    const button = this.querySelector('[data-testid="copy-bibtex"]');
    if (!pre || !button) return;
    try {
      await navigator.clipboard.writeText(pre.textContent ?? '');
      button.textContent = 'Copied';
    } catch {
      // No clipboard permission (an insecure origin, or a refused prompt). Select
      // the entry instead, so a copy is one keystroke away.
      getSelection()?.selectAllChildren(pre);
      button.textContent = 'Selected';
    }
    setTimeout(() => (button.textContent = 'Copy'), 1500);
  }

  private linksFor(program: Program, repositoryUrl: string): { label: string; href: string }[] {
    const links = [
      { label: `${program.file} (raw)`, href: programUrl(program) },
      ...(program.diagram
        ? [{ label: `${program.diagram.file} (full size)`, href: diagramUrl(program) ?? '' }]
        : []),
      {
        label: 'History on GitHub',
        href: `${repositoryUrl}/commits/main/programs/${program.file}`,
      },
    ];
    if (program.source?.doi) {
      links.push({ label: `doi:${program.source.doi}`, href: `https://doi.org/${program.source.doi}` });
    }
    if (program.source?.url) {
      links.push({ label: 'Source', href: program.source.url });
    }
    return links;
  }
}

if (!customElements.get(ProgramMetaComponent.tagName)) {
  customElements.define(ProgramMetaComponent.tagName, ProgramMetaComponent);
}
