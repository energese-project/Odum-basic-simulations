/**
 * Light/dark, and telling the canvas about it.
 *
 * energese.css already answers the OS preference on its own, and an explicit
 * choice via [data-theme] beats it in both directions. So everything that
 * styles itself in CSS — the shell, the panels, the CodeMirror editor, which
 * takes its colours as `var(--e-...)` — needs nothing from this module.
 *
 * A <canvas> is the exception. Chart.js reads its colours once and paints
 * pixels, so a theme change leaves the chart in the old palette until something
 * tells it to re-read. That is what `theme-changed` is for, and it has to fire
 * for the OS-preference route as well as the button, which is why the media
 * query is watched rather than just the toggle.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'obs-theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** The theme actually in force, whether it was chosen or inherited from the OS. */
export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return darkQuery.matches ? 'dark' : 'light';
}

/** True when the theme is the OS preference rather than an explicit choice. */
export function isFollowingSystem(): boolean {
  return !document.documentElement.hasAttribute('data-theme');
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing. The choice holds for this page load and is forgotten.
  }
  announce();
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

function announce(): void {
  window.dispatchEvent(new CustomEvent<Theme>('theme-changed', { detail: currentTheme() }));
}

// Only meaningful while no explicit choice is stored; once [data-theme] is set
// the attribute wins in CSS and currentTheme() reports the same value either way.
darkQuery.addEventListener('change', () => {
  if (isFollowingSystem()) announce();
});

/**
 * Read a design token off the document. Chart.js needs concrete colour strings —
 * it cannot hand `var(--e-series-1)` to a canvas context.
 */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The eight categorical series colours, in their validated order. */
export function seriesColours(): string[] {
  return Array.from({ length: 8 }, (_, i) => token(`--e-series-${i + 1}`));
}
