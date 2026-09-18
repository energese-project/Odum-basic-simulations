import { BaseComponent } from '../../core/base-component.ts';
import { formatCitation } from '../../basic/program-catalog.ts';
import { programUrl, type Program } from '../../basic/programs.ts';
import template from './program-meta.html?raw';
import style from './program-meta.css?raw';

/**
 * Where this listing came from.
 *
 * The archive is only worth having if a reader can check a program against its
 * source, so the provenance sits next to the program rather than behind a link.
 * The fidelity badge is first because it changes what the rest of the panel
 * means: a verbatim transcription and a model rewritten to run here answer
 * different questions, and nobody should have to infer which they are reading.
 */

const FIDELITY_EXPLANATION: Record<string, string> = {
  verbatim: 'Transcribed from the source, character for character.',
  corrected: 'Transcribed from the source, with errors in the original fixed — see the note.',
  adapted: 'The published model, rewritten to run here. Not the published listing.',
  original: 'Written for this repository as a worked example. Not from a published listing.',
};

export class ProgramMetaComponent extends BaseComponent {
  static tagName = 'program-meta';

  constructor() {
    super(template, style);
  }

  show(program: Program, repositoryUrl: string): void {
    const badge = this.querySelector<HTMLElement>('[data-testid="fidelity-badge"]');
    if (badge) {
      badge.textContent = program.fidelity;
      badge.dataset.fidelity = program.fidelity;
      badge.title = FIDELITY_EXPLANATION[program.fidelity] ?? '';
    }

    const citation = this.querySelector<HTMLElement>('[data-testid="citation"]');
    if (citation) {
      citation.textContent = program.source
        ? formatCitation(program.source)
        : FIDELITY_EXPLANATION[program.fidelity] ?? '';
    }

    const notes = this.querySelector<HTMLElement>('[data-testid="meta-notes"]');
    if (notes) {
      notes.textContent = program.notes ?? '';
      notes.hidden = !program.notes;
    }

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

  private linksFor(program: Program, repositoryUrl: string): { label: string; href: string }[] {
    const links = [
      { label: `${program.file} (raw)`, href: programUrl(program) },
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
