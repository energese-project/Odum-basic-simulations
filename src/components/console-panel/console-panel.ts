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
    this.hideInput();
  }

  append(text: string): void {
    if (!this.out) return;
    // Pinned to the bottom only when it was already there, so scrolling back
    // through a long run is not yanked forward by the next flush.
    const atBottom =
      this.out.scrollHeight - this.out.scrollTop - this.out.clientHeight < 40;
    this.out.textContent += text;
    if (atBottom) this.out.scrollTop = this.out.scrollHeight;
  }

  get text(): string {
    return this.out?.textContent ?? '';
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
