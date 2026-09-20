import { BaseComponent } from '../../core/base-component.ts';
import { onEngineStatus, type EngineStatus } from '../../basic/engine-loader.ts';
import template from './engine-status.html?raw';
import style from './engine-status.css?raw';

/**
 * Whether the C engine is up, in the topbar.
 *
 * The engine is fetched and instantiated in the browser, which can fail — a
 * stale cache, a blocked request, a browser without WebAssembly. When it does,
 * the editor silently stops checking, and silence is the wrong answer to "why
 * has it stopped underlining my mistakes". This says so instead.
 *
 * On the wording: the engine checks listings, and *only* checks them. Running a
 * program goes through the TypeScript interpreter and works whether or not this
 * is green, so the label says "engine" and the title says what that covers. It
 * will mean more when execution moves across; it must not claim to now.
 */

const LABELS: Record<EngineStatus, string> = {
  loading: 'Engine loading',
  ready: 'Engine ready',
  unavailable: 'Engine unavailable',
};

const TITLES: Record<EngineStatus, string> = {
  loading: 'The BASIC engine (C, compiled to WebAssembly) is starting.',
  ready:
    'The BASIC engine (C, compiled to WebAssembly) is running, and checks your listing as you type. Running a program does not depend on it.',
  unavailable:
    'The BASIC engine could not be loaded, so listings are not being checked as you type. Running a program is unaffected.',
};

export class EngineStatusComponent extends BaseComponent {
  static tagName = 'engine-status';

  private unsubscribe: (() => void) | null = null;

  constructor() {
    super(template, style);
  }

  init(): void {
    // Subscribing is also what starts the load: nothing else on the page needs
    // the engine until the editor is typed into, and a light that only turns
    // green once you start typing would be describing itself, not the engine.
    this.unsubscribe = onEngineStatus((status) => this.paint(status));
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private paint(status: EngineStatus): void {
    const root = this.querySelector<HTMLElement>('.engine-status');
    const label = this.querySelector('.label');
    if (!root || !label) return;
    root.dataset.state = status;
    root.title = TITLES[status];
    label.textContent = LABELS[status];
  }
}

if (!customElements.get(EngineStatusComponent.tagName)) {
  customElements.define(EngineStatusComponent.tagName, EngineStatusComponent);
}
