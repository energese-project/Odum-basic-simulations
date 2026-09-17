import { Router } from './router/router.ts';

/**
 * Hand same-origin links to the client-side router instead of the browser.
 *
 * Without this a link to /projects inside a page component triggers a full
 * document request. GitHub Pages answers it (404.html is a copy of index.html,
 * so it resolves) but the whole app reloads, which is slow and loses scroll
 * position. External links and anchors are left alone.
 */
export function bindInternalLinks(root: ParentNode): void {
  root.querySelectorAll<HTMLAnchorElement>('a[href^="/"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      Router.getInstance().navigate(href);
    });
  });
}
