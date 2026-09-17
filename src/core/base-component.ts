export function html(
  strings: TemplateStringsArray,
  ...values: any[]
): string {
  return strings.reduce((acc, str, i) => {
    let val = values[i];
    if (val === undefined || val === null) {
      val = '';
    } else if (Array.isArray(val)) {
      val = val.join('');
    } else if (typeof val === 'function') {
      val = val();
    }
    return acc + str + val;
  }, '');
}

export function css(
  strings: TemplateStringsArray,
  ...values: any[]
): string {
  return strings.reduce(
    (acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ''),
    ''
  );
}

export class BaseComponent extends HTMLElement {
  template: HTMLTemplateElement;
  scopedStyleHtml = '';

  constructor(htmlContent: string, cssContent: string) {
    super();
    const tagName = this.tagName.toLowerCase();
    const scopedCss = cssContent.replace(/:host/g, tagName);
    this.scopedStyleHtml = `<style>${scopedCss}</style>`;
    this.template = document.createElement('template');
    this.template.innerHTML = `${this.scopedStyleHtml}${htmlContent}`;
  }

  connectedCallback() {
    this.appendChild(this.template.content.cloneNode(true));
    this.init();
  }

  init() {}

  /**
   * Helper for Event Delegation.
   * Enables attaching event listeners once on the host component that survive innerHTML updates.
   */
  delegate(eventType: string, selector: string, handler: (e: Event, element: HTMLElement) => void) {
    this.addEventListener(eventType, (e) => {
      const target = e.target as HTMLElement;
      const element = target.closest(selector) as HTMLElement;
      if (element && this.contains(element)) {
        handler.call(this, e, element);
      }
    });
  }

  /**
   * Declaratively updates the component's inner HTML.
   * Keeps the scoped style tag at the beginning and replaces the rest.
   */
  update(newHtml?: string) {
    const content = newHtml !== undefined ? newHtml : this.render();
    this.innerHTML = this.scopedStyleHtml + content;
  }

  /**
   * Can be overridden by subclasses for declarative rendering.
   */
  render(): string {
    return '';
  }
}

