import { BaseComponent } from '../../core/base-component.ts';
import { currentTheme, toggleTheme } from '../../core/theme.ts';
import template from './theme-toggle.html?raw';
import style from './theme-toggle.css?raw';

export class ThemeToggleComponent extends BaseComponent {
  static tagName = 'theme-toggle';

  constructor() {
    super(template, style);
  }

  init(): void {
    const button = this.querySelector('button');
    button?.addEventListener('click', () => {
      toggleTheme();
      this.paint();
    });
    // Also repaint when the OS preference changes underneath us, so the button
    // never offers to switch to the mode already showing.
    window.addEventListener('theme-changed', () => this.paint());
    this.paint();
  }

  private paint(): void {
    const dark = currentTheme() === 'dark';
    const icon = this.querySelector('.icon');
    const label = this.querySelector('.label');
    const button = this.querySelector('button');
    if (icon) icon.textContent = dark ? '☀' : '☾';
    if (label) label.textContent = dark ? 'Light' : 'Dark';
    const name = dark ? 'Switch to light theme' : 'Switch to dark theme';
    button?.setAttribute('aria-label', name);
    button?.setAttribute('title', name);
  }
}

if (!customElements.get(ThemeToggleComponent.tagName)) {
  customElements.define(ThemeToggleComponent.tagName, ThemeToggleComponent);
}
