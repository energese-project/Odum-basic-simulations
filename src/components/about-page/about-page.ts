import { BaseComponent } from '../../core/base-component.ts';
import { bindInternalLinks } from '../../core/internal-links.ts';
import template from './about-page.html?raw';
import style from './about-page.css?raw';

export class AboutPageComponent extends BaseComponent {
  static tagName = 'about-page';

  constructor() {
    super(template, style);
  }

  init(): void {
    bindInternalLinks(this);
  }
}

if (!customElements.get(AboutPageComponent.tagName)) {
  customElements.define(AboutPageComponent.tagName, AboutPageComponent);
}
