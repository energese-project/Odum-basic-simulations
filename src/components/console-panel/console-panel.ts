import { BaseComponent } from '../../core/base-component.ts';
import template from './console-panel.html?raw';
import style from './console-panel.css?raw';

/**
 * The teletype half of the workbench: what the program printed, and the line
 * INPUT is waiting for.
 *
 * It is also the chart's table view. The numeric rows the chart is drawn from
 * are visible here in full, which is what stops the plot being the only reading
 * of the run.
 */
export class ConsolePanelComponent extends BaseComponent {
  static tagName = 'console-panel';

  private out: HTMLElement | null = null;
  private form: HTMLFormElement | null = null;
  private input: HTMLInputElement | null = null;
  /** The end of the output that is not yet a whole line. See write(). */
  private tail: Text | null = null;

  constructor() {
    super(template, style);
  }

  init(): void {
    this.out = this.querySelector('.out');
    this.form = this.querySelector('form');
    this.input = this.querySelector('input');

    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = this.input?.value ?? '';
      this.hideInput();
      // Echo it, the way a terminal does — otherwise the transcript has the
      // question and the consequences but not the answer.
      this.append(value + '\n');
      this.dispatchEvent(
        new CustomEvent<string>('console-input', { detail: value, bubbles: true })
      );
    });
  }

  clear(): void {
    if (this.out) this.out.textContent = '';
    this.tail = null;
    this.hideInput();
  }

  append(text: string): void {
    if (!this.out) return;
    // Pinned to the bottom only when it was already there, so scrolling back
    // through a long run is not yanked forward by the next flush.
    const atBottom =
      this.out.scrollHeight - this.out.scrollTop - this.out.clientHeight < 40;
    this.write(text);
    if (atBottom) this.out.scrollTop = this.out.scrollHeight;
  }

  /**
   * Each piece of output that finishes a line becomes a block of its own; a line
   * not yet finished waits in a trailing text node. One <pre> of text is one
   * run of inline layout, so appending to it re-lays out every line above: a
   * 60,000-row run spent most of its 6.7 seconds doing that on the main thread.
   * A new block is laid out alone. The blocks carry their newlines, so the
   * transcript's text is unchanged, and copying it gives back what was printed.
   */
  private write(text: string): void {
    const out = this.out!;
    const end = text.lastIndexOf('\n');
    if (end === -1) {
      if (this.tail) this.tail.appendData(text);
      else if (text) out.append((this.tail = new Text(text)));
      return;
    }
    const block = document.createElement('div');
    block.textContent = (this.tail?.data ?? '') + text.slice(0, end + 1);
    this.tail?.remove();
    const rest = text.slice(end + 1);
    this.tail = rest ? new Text(rest) : null;
    out.append(block, ...(this.tail ? [this.tail] : []));
  }

  askForInput(): void {
    if (!this.form || !this.input) return;
    this.form.hidden = false;
    this.input.value = '';
    this.input.focus();
  }

  hideInput(): void {
    if (this.form) this.form.hidden = true;
  }
}

if (!customElements.get(ConsolePanelComponent.tagName)) {
  customElements.define(ConsolePanelComponent.tagName, ConsolePanelComponent);
}
