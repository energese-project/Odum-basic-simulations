import { BaseComponent } from '../../core/base-component.ts';
import type { DrawOp } from '../../basic/interpreter.ts';
import { Screen } from '../../basic/screen.ts';
import template from './screen-panel.html?raw';
import style from './screen-panel.css?raw';

/**
 * The IBM PC screen a listing drew on, rebuilt from its graphics statements.
 *
 * Its colours are the CGA palette the program chose, not the page's tokens: it
 * is a facsimile, like a scanned diagram, and Odum's figures are pictures of
 * this screen. The panel around it follows the theme as everything else does.
 *
 * Drawing is batched to one repaint per frame. The worker already batches the
 * operations every 40ms; this keeps a burst of batches to one putImageData.
 */
export class ScreenPanelComponent extends BaseComponent {
  static tagName = 'screen-panel';

  private screen = new Screen();
  private frame: number | null = null;

  constructor() {
    super(template, style);
  }

  disconnectedCallback(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** True once the program has set a graphics mode: there is a screen to show. */
  get active(): boolean {
    return this.screen.mode !== 0;
  }

  reset(): void {
    this.screen = new Screen();
    this.paint();
  }

  draw(ops: DrawOp[]): void {
    for (const op of ops) this.screen.apply(op);
    this.frame ??= requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  private paint(): void {
    const canvas = this.querySelector('canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const { width, height } = this.screen;
    if (width === 0) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.putImageData(new ImageData(this.screen.rgba(), width, height), 0, 0);
  }
}

if (!customElements.get(ScreenPanelComponent.tagName)) {
  customElements.define(ScreenPanelComponent.tagName, ScreenPanelComponent);
}
