# AGENTS.md

The standard for this repository. Read it before changing anything.

## 1. What this is

A browser workbench for the BASIC simulation listings in the systems-ecology
literature — the programs Odum printed in his books, which were meant to be typed in
and run and which almost nobody can run any more. It is a static site: no server, no
database, no API.

It is a **project** Pages site, served from
`https://energese-project.github.io/Odum-basic-simulations/`, not from the domain
root. Two things follow:

- `base` in [`vite.config.js`](vite.config.js) is `/Odum-basic-simulations/`. Not `./` —
  a relative base makes `import.meta.env.BASE_URL` the string `'./'`, and the router
  needs a real prefix to strip off `window.location.pathname` before matching a route.
- `window.BOBA_BASE_URL` in [`src/main.ts`](src/main.ts) is set from
  `import.meta.env.BASE_URL`, never from a literal. The repository name appears in
  `vite.config.js` and nowhere else, and the dev server is mounted under the same
  prefix as production so the two cannot disagree.

**The interpreter is the product.** The build, the panels and the framework are
scaffolding around it; what makes this repository worth anything is that a published
listing runs unaltered. When a choice is between "the listing has to change" and "the
interpreter has to change", it is the interpreter that changes.

## 2. Stack

Vite, TypeScript, Web Components via [Boba](https://github.com/sholtomaud/boba),
Tailwind v4. Two runtime dependencies, Monaco and Chart.js, plus Boba itself,
which is vendored rather than installed. Both are bundled from npm: nothing is
fetched from a CDN at runtime, so the built site keeps working for as long as the
files exist.

`src/core/` is Boba, copied in — Boba is a scaffold (`npx github:sholtomaud/boba`),
not a package, so there is no version to bump and no import to update. Treat those
files as upstream: fix a bug there by fixing it upstream and re-copying, so the
change is not lost the next time they are refreshed. The two local edits so far are
noted in the files themselves.

Do not add a framework runtime. A page with three panels does not need one.

## 3. Everything runs in the container

The host is not assumed to have Node. Every npm command goes through the Apple
`container` image defined in [`Containerfile`](Containerfile), driven by the
[`Makefile`](Makefile). Run `make help` for the targets.

**The Playwright version appears in two places — `package.json` and
`Containerfile` — and they move together. The one in `package.json` carries no
caret.** The browser binary lives in the image, which `package-lock.json` does not
govern, so a caret would let the test runner float ahead of the browser build it was
compiled against. That fails as

```
Executable doesn't exist at .../chromium_headless_shell-1243/...
```

which reads like a broken suite and is really a version skew. Bumping Playwright
means editing both strings and rebuilding with `make image`.

CI does not use the image — it installs the browser with `npx playwright install`,
which reads the version from `package.json`, so there is no third string to keep in
step.

## 4. Before pushing

```sh
make check
```

That is typecheck, unit tests and the full Playwright suite — the same three things
CI runs, in the same order. All must pass with zero errors.

There is no ESLint. `tsc --noEmit` runs with `strict`, `noUnusedLocals` and
`noUnusedParameters`, which is the gate. Do not add a linter on top without a defect
it would have caught.

## 5. Push *and* open a PR

CI runs on `pull_request`. A pushed branch with no PR has been tested by nothing. Do
not stop at the push, and do not merge your own PR — hand over a green one.

A task is done when it is **merged**, not when it is written.

## 6. Branches

`feat/`, `fix/`, `docs/`, `chore/`. The `pull_request` trigger in
[`ci.yml`](.github/workflows/ci.yml) lists all four as permitted bases, so a PR
stacked on another branch still runs the jobs. Adding a fifth prefix means adding it
there too, or PRs against it are silently unverified.

## 7. Components

One directory per component under `src/components/`, containing three files:

```
src/components/chart-panel/
  chart-panel.ts      # class extending BaseComponent, registers the custom element
  chart-panel.html    # imported with ?raw
  chart-panel.css     # imported with ?raw; :host is rewritten to the tag name
```

Conventions:

- Custom element tags are kebab-case, and the class exposes the tag as `static tagName`.
- Imports carry the `.ts` extension. This is mandatory, not stylistic.
- Register with the `if (!customElements.get(...))` guard — a hot reload otherwise
  throws on re-registration.
- A new route component must be imported in [`src/main.ts`](src/main.ts) as well as
  registered in the route table. The router does not lazy-load; see the comment on
  `loadComponent` for why.
- Internal links (`href="/..."`) must be passed to `bindInternalLinks(this)` in
  `init()`. Without it the browser does a full document load.
- `BaseComponent.update()` replaces `innerHTML`. Any component holding a live object
  that owns DOM — a Monaco editor, a Chart.js instance — must not use it, and must
  dispose that object in `disconnectedCallback()`. Monaco leaks its model as well as
  its editor, so both are disposed.

## 8. The interpreter

[`src/basic/interpreter.ts`](src/basic/interpreter.ts) knows nothing about the DOM.
Its whole contact with the outside world is the callbacks in `BasicIO`, which is what
lets the same class run in a Worker, on the main thread and under `node --test`. Keep
it that way: a `document` reference in there breaks the unit tests, which are the only
cheap way to check a language change.

**Every language change needs a test in
[`interpreter.test.ts`](src/basic/interpreter.test.ts) written against a listing, not
against an internal method.** The tests run a program and assert on what it printed,
because that is the only thing the published listings care about.

`run()` yields every `YIELD_INTERVAL` statements and checks `shouldHalt` there. That
yield is a `setTimeout`, not a microtask, deliberately — a microtask drains straight
back into the loop without letting the worker's event loop deliver the stop message.
Do not "optimise" it into `queueMicrotask`.

## 9. Design tokens

The palette lives in [`src/styles/energese.css`](src/styles/energese.css) and **this
repository holds a copy, not the original.** The canonical copy is in
`energese-project.github.io` at `src/styles/energese.css`; another sits in GSSK at
`web/energese.css`. The file's header states this and carries `--e-tokens-version` so
a stale copy is visible rather than silent.

**Changing a colour is a multi-repository change, and it does not start here.** Edit
the canonical copy, bump `--e-tokens-version`, copy the whole file to every consumer,
and open a PR in each. `diff` should report them identical, header included.

Two rules that are not stylistic:

- **`--e-series-1` … `--e-series-8` and their order** are a colour-blindness safety
  mechanism, validated as a set against each surface. Reordering or extending them
  breaks that silently — the chart still renders. Past eight, the hues repeat and the
  **line style** carries the difference (`SERIES_DASHES` in
  [`chart-panel.ts`](src/components/chart-panel/chart-panel.ts)).
- **Nothing may hardcode a colour.** `bg-white`, `text-white` and `fill="#fff"` all
  survive a token migration untouched and then glow white on a dark page.
  [`e2e/theming.spec.ts`](e2e/theming.spec.ts) is what keeps that out.

Anything pairing a foreground with a background must use tokens that **invert
together**. The primary button is `--e-accent` on `--e-ground`, not white on
`--e-ink`: `--e-ink` is near-white in dark mode, so the second pairing inverts into
white-on-white.

**Two things do not follow the tokens.** Chart.js reads colours once and paints
pixels; Monaco's theme API takes literal hex and holds a snapshot. Both have to be
told when the palette moves, which is what `theme-changed` in
[`src/core/theme.ts`](src/core/theme.ts) is for. It fires for the OS-preference
route, for the toggle, and — via a `MutationObserver` on `[data-theme]` — for
anything that writes the attribute directly, because "always call setTheme()" is a
rule nothing can enforce.

**Monaco wants six-digit hex, and the production CSS minifier does not give it.**
`--e-surface: #ffffff` is served as `#fff` from the built bundle and as `#ffffff`
from the dev server. Monaco rejects the short form with `Illegal value for token
color`, which throws during construction and leaves an empty editor with no
message on the page. [`hex.ts`](src/components/code-editor/hex.ts) normalises it;
that divergence is only visible in the `production` Playwright project, which is
why that project exists.

## 10. Charts

One y axis. Never two. Columns of different magnitude — a storage in the thousands
beside a flow in the tens — share the axis and the smaller one reads as flat, which is
the true relationship; a second scale makes them look comparable when they are not.

The console beside the chart is the table view: everything the program printed stays
readable there, so the plot is never the only reading of a run. Do not collapse it.

## 11. Deployment

`main` → [`deploy.yml`](.github/workflows/deploy.yml) → GitHub Pages. The workflow
copies `dist/index.html` to `dist/404.html`; that copy is the only reason a
client-side route survives being entered directly. It also writes `.nojekyll`,
without which Jekyll drops files whose names begin with an underscore.

`configure-pages` runs with `enablement: true`, so the workflow turns Pages on
itself rather than requiring a visit to Settings. Do not remove that: without it
the first deploy of a fresh clone or fork dies on a 404 from the Pages API, which
reads like a broken workflow and is really an untouched setting.
