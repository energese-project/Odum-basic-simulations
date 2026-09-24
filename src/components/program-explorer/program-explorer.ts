import { BaseComponent } from '../../core/base-component.ts';
import { buildTree, type TreeNode } from '../../basic/program-library.ts';
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

/** VS Code's chevron-right; turned a quarter for an open folder, in the CSS. */
const CHEVRON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
  '<path d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z" fill="currentColor"/>' +
  '</svg>';

/** How long typed letters count as one name, as in VS Code's type navigation. */
const TYPEAHEAD_MS = 700;

interface Row {
  node: TreeNode;
  level: number;
}

/**
 * The sidebar's file tree, built to work like VS Code's explorer, because that
 * is the file tree most readers already know: folders open and close
 * independently, the chevron only folds, the arrow keys walk the tree, typing
 * jumps to a name, and the active file is revealed. It is one ARIA tree with a
 * single tab stop (roving tabindex), drawn as a flat list of rows with
 * `aria-level`, which is how VS Code draws it too.
 *
 * It owns no navigation. Opening a program dispatches `program-selected` ({id})
 * and opening a file `file-selected` ({id, path}); the workbench decides what
 * that means. An image is not text, so its row is a link to the published file.
 */
export class ProgramExplorerComponent extends BaseComponent {
  static tagName = 'program-explorer';

  private programs: Program[] = [];
  private current: { id: string; path: string } | null = null;
  /** Folder keys that are open. Survives filtering, as VS Code's does. */
  private readonly expanded = new Set<string>();
  /** The row holding the tree's one tab stop. */
  private focusKey: string | null = null;
  private nodes = new Map<string, TreeNode>();
  private typed = '';
  private typedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super(template, style);
  }

  private get input(): HTMLInputElement | null {
    return this.querySelector('[data-testid="library-filter"]');
  }

  private get tree(): HTMLElement | null {
    return this.querySelector('[data-testid="library-list"]');
  }

  init(): void {
    this.input?.addEventListener('input', () => this.draw());
    this.tree?.addEventListener('click', (event) => this.onClick(event));
    this.tree?.addEventListener('keydown', (event) => this.onKey(event));

    this.querySelector('[data-testid="collapse-all"]')?.addEventListener('click', () => {
      this.expanded.clear();
      this.draw();
    });
    const toggle = this.querySelector<HTMLElement>('[data-testid="section-toggle"]');
    toggle?.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      const body = this.querySelector<HTMLElement>('.section-body');
      if (body) body.hidden = !open;
    });
  }

  setPrograms(programs: Program[]): void {
    this.programs = programs;
    this.draw();
  }

  /** The program on screen and the file the editor shows: revealed and selected. */
  setCurrent(id: string, path: string): void {
    this.current = { id, path };
    for (const key of this.pathTo(`f:${path}`)) this.expanded.add(key);
    this.focusKey = `f:${path}`;
    this.draw();
    this.rowFor(this.focusKey)?.scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------ drawing

  // Rebuilds the rows only. BaseComponent.update() would replace the filter
  // input too, and take the reader's cursor with it on every keystroke.
  private draw(): void {
    const tree = this.tree;
    const empty = this.querySelector<HTMLElement>('[data-testid="library-empty"]');
    if (!tree) return;
    const hadFocus = tree.contains(document.activeElement);

    const rows: Row[] = [];
    this.nodes = new Map();
    const walk = (nodes: TreeNode[], level: number): void => {
      for (const node of nodes) {
        rows.push({ node, level });
        this.nodes.set(node.key, node);
        if (this.expanded.has(node.key)) walk(node.children, level + 1);
      }
    };
    walk(buildTree(this.programs, this.input?.value ?? ''), 1);

    if (!this.focusKey || !this.nodes.has(this.focusKey)) this.focusKey = rows[0]?.node.key ?? null;
    tree.replaceChildren(...rows.map((row) => this.row(row)));
    if (empty) empty.hidden = rows.length > 0 || this.programs.length === 0;
    if (hadFocus) this.rowFor(this.focusKey)?.focus();
  }

  private row({ node, level }: Row): HTMLElement {
    const image = node.file?.kind === 'image';
    const el = document.createElement(image ? 'a' : 'div');
    if (image && node.file && el instanceof HTMLAnchorElement) {
      el.href = fileUrl(node.file.path);
      el.target = '_blank';
      el.rel = 'noopener';
    }
    el.className = 'row';
    el.setAttribute('role', 'treeitem');
    el.dataset.key = node.key;
    el.dataset.kind = node.kind;
    el.dataset.name = node.name;
    el.tabIndex = node.key === this.focusKey ? 0 : -1;
    el.setAttribute('aria-level', String(level));
    el.setAttribute('aria-selected', String(node.key === `f:${this.current?.path}`));
    if (node.kind !== 'file') el.setAttribute('aria-expanded', String(this.expanded.has(node.key)));
    if (node.kind === 'program') {
      el.setAttribute('aria-current', String(node.programId === this.current?.id));
    }
    el.title = this.hint(node);

    for (let i = 1; i < level; i++) {
      const guide = document.createElement('span');
      guide.className = 'guide';
      el.append(guide);
    }
    const twistie = document.createElement('span');
    twistie.className = 'twistie';
    if (node.kind !== 'file') twistie.innerHTML = CHEVRON;
    el.append(twistie);

    if (node.file) {
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.dataset.type = node.file.kind;
      icon.setAttribute('aria-hidden', 'true');
      el.append(icon);
    }

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.name;
    el.append(label);

    const program = node.kind === 'program' ? this.program(node.programId) : undefined;
    if (program) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.dataset.fidelity = program.fidelity;
      badge.textContent = program.fidelity;
      el.append(badge);
    }
    return el;
  }

  private hint(node: TreeNode): string {
    if (node.file) return node.file.kind === 'image' ? `${node.file.path}, full size in a new tab` : node.file.path;
    const program = node.kind === 'program' ? this.program(node.programId) : undefined;
    if (!program) return node.name;
    return `${program.description}\n\n${program.fidelity}: ${FIDELITY_EXPLANATION[program.fidelity] ?? ''}`;
  }

  // ------------------------------------------------------------ acting

  private onClick(event: MouseEvent): void {
    const el = (event.target as Element).closest<HTMLElement>('.row');
    const node = el ? this.nodes.get(el.dataset.key ?? '') : undefined;
    if (!el || !node) return;
    this.focusKey = node.key;
    // The chevron only folds, as in VS Code: looking inside is not opening.
    this.activate(node, Boolean((event.target as Element).closest('.twistie')));
  }

  /** What a click or Enter does. An image row is a link and needs nothing here. */
  private activate(node: TreeNode, foldOnly = false): void {
    if (node.kind === 'file') {
      if (node.file && node.file.kind !== 'image') {
        this.emit('file-selected', { id: node.programId, path: node.file.path });
      }
      return;
    }
    if (!foldOnly && node.kind === 'program' && node.programId !== this.current?.id) {
      this.emit('program-selected', { id: node.programId });
      return;
    }
    this.setExpanded(node.key, !this.expanded.has(node.key));
  }

  private setExpanded(key: string, open: boolean): void {
    if (open) this.expanded.add(key);
    else this.expanded.delete(key);
    this.draw();
  }

  private onKey(event: KeyboardEvent): void {
    const rows = Array.from(this.tree?.querySelectorAll<HTMLElement>('.row') ?? []);
    const index = rows.findIndex((r) => r === document.activeElement);
    if (index < 0) return;
    const el = rows[index];
    const node = this.nodes.get(el.dataset.key ?? '');
    if (!node) return;
    const level = Number(el.getAttribute('aria-level'));
    const folder = node.kind !== 'file';
    const open = this.expanded.has(node.key);

    const move = (to: HTMLElement | undefined): void => {
      if (!to) return;
      this.focusKey = to.dataset.key ?? null;
      for (const r of rows) r.tabIndex = r === to ? 0 : -1;
      to.focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        move(rows[index + 1]);
        break;
      case 'ArrowUp':
        move(rows[index - 1]);
        break;
      case 'Home':
        move(rows[0]);
        break;
      case 'End':
        move(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        if (folder && !open) this.setExpanded(node.key, true);
        else if (folder && Number(rows[index + 1]?.getAttribute('aria-level')) === level + 1) {
          move(rows[index + 1]);
        }
        break;
      case 'ArrowLeft':
        if (folder && open) this.setExpanded(node.key, false);
        else move(rows.slice(0, index).reverse().find((r) => Number(r.getAttribute('aria-level')) === level - 1));
        break;
      case 'Enter':
        // A link row follows itself on Enter; anything else is activated here.
        if (el instanceof HTMLAnchorElement) return;
        this.activate(node);
        break;
      case ' ':
        if (el instanceof HTMLAnchorElement) el.click();
        else this.activate(node);
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          this.typeahead(event.key, rows, index, move);
          break;
        }
        return;
    }
    event.preventDefault();
  }

  /** Jump to the next row whose name starts with what has just been typed. */
  private typeahead(
    key: string,
    rows: HTMLElement[],
    index: number,
    move: (to: HTMLElement | undefined) => void
  ): void {
    this.typed += key.toLowerCase();
    if (this.typedTimer !== null) clearTimeout(this.typedTimer);
    this.typedTimer = setTimeout(() => (this.typed = ''), TYPEAHEAD_MS);
    // A first letter looks past the current row, so pressing it again cycles;
    // a longer prefix may still match the row it is on.
    const start = this.typed.length === 1 ? index + 1 : index;
    const order = [...rows.slice(start), ...rows.slice(0, start)];
    move(order.find((r) => (r.dataset.name ?? '').toLowerCase().startsWith(this.typed)));
  }

  // ------------------------------------------------------------ helpers

  private program(id: string | undefined): Program | undefined {
    return this.programs.find((p) => p.id === id);
  }

  private rowFor(key: string | null): HTMLElement | null {
    return key ? this.querySelector<HTMLElement>(`.row[data-key="${CSS.escape(key)}"]`) : null;
  }

  /** The folders above a row, outermost first — what has to be open to see it. */
  private pathTo(key: string): string[] {
    const find = (nodes: TreeNode[], trail: string[]): string[] | null => {
      for (const node of nodes) {
        if (node.key === key) return trail;
        const found = find(node.children, [...trail, node.key]);
        if (found) return found;
      }
      return null;
    };
    return find(buildTree(this.programs, ''), []) ?? [];
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }
}

if (!customElements.get(ProgramExplorerComponent.tagName)) {
  customElements.define(ProgramExplorerComponent.tagName, ProgramExplorerComponent);
}
