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

## 2. Built to last

This repository is an archive. Its job is to still work — and still be
understandable — long after the people who wrote it have stopped maintaining it.
The two rules below are **constraints on every change**, not preferences, and a
change that breaks either needs an argument in its pull request, not just a diff.

### Native platform first, third-party code last

Vanilla Web Components, ES modules, the DOM, `fetch`, Web Workers. The browser
platform is the one dependency that is certain to outlive this code, so reach for
it first.

- **Runtime dependencies are Monaco and Chart.js, and the list is meant to stay
  that short.** Each is bundled from npm; nothing is fetched from a CDN at
  runtime, so the built site does not depend on any third-party host staying up.
- **Build and test tooling is exempt** — Vite, TypeScript, Tailwind, Playwright.
  None of it ships in the page. If Vite disappeared, `dist/` would keep working.
- **Adding a runtime dependency needs a stated reason** in the pull request: what
  it does that the platform cannot, and what happens to the site if the package is
  abandoned. "It is smaller to write" is not a reason; an archive is read and run
  far more often than it is written.
- **Prefer a few lines of our own code to a small library.** The metadata
  validator in `src/basic/program-catalog.ts` is hand-written rather than a schema
  library for exactly this reason: it is short, it is tested, and it cannot be
  deprecated out from under us.

### Test first

**Every change begins with a failing test.** Red, then green, then refactor.

- **Behaviour is tested from the outside.** Interpreter tests run a BASIC listing
  and assert on what it printed, never on an internal method. Archive tests are
  phrased as the mistakes a contributor could make. A test that would survive a
  rewrite of the implementation is the kind worth having.
- **A bug fix starts by reproducing the bug in a test.** The `REM`-with-a-colon
  bug and the minified `#fff` bug both have tests that fail on the old code; that
  is what stops them coming back.
- **Both halves of the suite run on every PR**: `node --test` for logic, and
  Playwright against *both* the dev server and the production build. The
  production project is not redundant. The `#fff` bug reproduced only there.
- Anything pure goes in a module with no DOM reference, so it can be unit-tested
  directly. Where something needs the DOM or the filesystem, split the pure part
  out — `hex.ts` from `editor-theme.ts`, `program-catalog.ts` from
  `program-archive.ts`.

## 3. Stack

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

## 4. Everything runs in the container

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

CI's `check` job does not use the image — it installs the browser with
`npx playwright install`, which reads the version from `package.json`, so there is no
third string to keep in step. The `figures` job does build it, from this same
`Containerfile`, because its screenshots are only comparable in the environment that
made them (§14).

## 5. Before pushing

```sh
make check
```

That is typecheck, unit tests and the full Playwright suite — the same three things
CI runs, in the same order. All must pass with zero errors.

There is no ESLint. `tsc --noEmit` runs with `strict`, `noUnusedLocals` and
`noUnusedParameters`, which is the gate. Do not add a linter on top without a defect
it would have caught.

## 6. Push *and* open a PR

CI runs on `pull_request`. A pushed branch with no PR has been tested by nothing. Do
not stop at the push, and do not merge your own PR — hand over a green one.

A task is done when it is **merged**, not when it is written.

## 7. Branches

`feat/`, `fix/`, `docs/`, `chore/`. The `pull_request` trigger in
[`ci.yml`](.github/workflows/ci.yml) lists all four as permitted bases, so a PR
stacked on another branch still runs the jobs. Adding a fifth prefix means adding it
there too, or PRs against it are silently unverified.

## 8. Components

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
- **Only `:host` is scoped.** `BaseComponent` rewrites `:host` to the tag name and
  leaves every other selector alone, so a bare `.title` or `.empty` in one component's
  CSS restyles every element with that class on the page — including inside Monaco's
  DOM. Prefix each selector with `:host` (`:host .title`). Nothing fails when this is
  forgotten; the text is just the wrong size somewhere else.

## 9. The interpreter

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

## 10. The program archive

`programs/` is at the repository root, not under `src/`, because the listings are
the point of the repository rather than part of the application. Someone arriving
to check a model against its source should find them without reading TypeScript.

Every program is `<id>.bas` plus `<id>.json`. The full contributor-facing format is
in [`programs/README.md`](programs/README.md); what matters for changing the code:

- **There is no manifest.** `vite-plugin-programs.js` builds
  `programs/index.json` from the directory at build time. Do not add a hand-kept
  list back — the one this replaced went stale the first time a program was added.
- **Validation fails the build.** A listing whose provenance cannot be read is
  worse than absent: it looks authoritative and is not. The rules live in
  [`program-archive.ts`](src/basic/program-archive.ts) (directory shape) and
  [`program-catalog.ts`](src/basic/program-catalog.ts) (metadata), both
  unit-tested. The plugin is glue and should stay that way.
- **`fidelity` is required and has no default.** `verbatim`, `corrected`,
  `adapted`, `original`. It changes what every other field means, which is why a
  contributor must choose it rather than inherit it.
- **The raw files are published**, not just the index, so a citation can link to
  the listing itself. The e2e suite checks each published `.bas` is byte-identical
  to the catalog copy the app ran.
- **Only `.bas`, `.json`, `README.md` and declared diagrams may live in
  `programs/`.** It is published verbatim. A diagram (`<id>.png|jpg|jpeg|webp`,
  ≤ 2 MB, content matching its extension) is published only when its sidecar's
  `diagram` block records the rights it is reproduced under. `rights.basis` has no
  default, for the same reason as `fidelity`, and anything other than `own-work`
  needs a `source`. An image no sidecar claims fails the build: nobody has said it
  may be published. Page photos for the reviewer still belong in the pull request.
- **Programs can arrive through an issue form.**
  [`add-program.yml`](.github/ISSUE_TEMPLATE/add-program.yml) →
  [`program-submission.yml`](.github/workflows/program-submission.yml) →
  [`scripts/submit-program.ts`](scripts/submit-program.ts), which builds the files
  with [`submission.ts`](src/basic/submission.ts) and checks them with the same
  `parseProgramMeta` and `readCatalog` as the build. There are no rules of its own.
  Three things to keep:
  - **The issue body is untrusted and is never interpolated into a `run:` block.**
    The script reads it from `$GITHUB_EVENT_PATH`. The workflow only uses the issue
    number in shell.
  - **Form fields are matched by label text.** Renaming a label in the YAML without
    changing `FORM_LABELS` (or `IGNORED_LABELS`) loses that field from every
    submission. `submission.test.ts` checks the two against each other.
  - **A PR opened with `GITHUB_TOKEN` does not trigger `pull_request`**, so the
    workflow dispatches `ci.yml` on the branch. That is why `ci.yml` has a
    `workflow_dispatch` trigger. Removing it leaves submitted programs untested.
- **"My programs" is the reader's own workspace, in OPFS.** The model is
  [`workspace.ts`](src/basic/workspace.ts), pure and tested against an in-memory
  store. The browser store is [`opfs-store.ts`](src/workspace/opfs-store.ts). Keep
  these:
  - **The archive is never copied into OPFS.** It is fetched fresh and is
    read-only. A mirrored copy goes stale when a listing is corrected upstream,
    and an edited copy of a `verbatim` listing is not verbatim. "Copy to My
    programs" clears the fidelity and records where the copy came from.
  - **Everything lives under `odum-basic-simulations/`** in OPFS, because
    `energese-project.github.io` is one origin shared by every Pages site in the
    organisation.
  - **Two write routes.** `createWritable()` reached Safari late, so where it is
    missing, writes go through
    [`opfs-writer.worker.ts`](src/workspace/opfs-writer.worker.ts) with a sync
    access handle. `workspace.spec.ts` deletes `createWritable` to exercise that
    route in Chromium. Without it, the fallback would never run in CI.
  - **Submitting goes through the issue form, not the GitHub API.** A static site
    cannot sign anyone in: GitHub's token exchange needs the client secret and
    refuses CORS preflight. So the app opens the form prefilled by field `id`
    (`FORM_IDS`, `issueFormUrl`), and the bot does the rest. GitHub cannot
    prefill an attachment, and may not prefill dropdowns, so the Submit dialog
    hands over the image as a download and lists the dropdown choices.
- **No SVG diagrams.** An SVG opened directly from the published site runs its own
  scripts on the org's `github.io` origin. Raster images cannot.

## 11. Design tokens

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

## 12. Charts

One y axis. Never two. Columns of different magnitude — a storage in the thousands
beside a flow in the tens — share the axis and the smaller one reads as flat, which is
the true relationship; a second scale makes them look comparable when they are not.

The console beside the chart is the table view: everything the program printed stays
readable there, so the plot is never the only reading of a run. Do not collapse it.

## 13. Deployment

`main` → [`deploy.yml`](.github/workflows/deploy.yml) → GitHub Pages. The workflow
copies `dist/index.html` to `dist/404.html`; that copy is the only reason a
client-side route survives being entered directly. It also writes `.nojekyll`,
without which Jekyll drops files whose names begin with an underscore.

`configure-pages` runs with `enablement: true`, so the workflow turns Pages on
itself rather than requiring a visit to Settings. Do not remove that: without it
the first deploy of a fresh clone or fork dies on a 404 from the Pages API, which
reads like a broken workflow and is really an untouched setting.

## 14. The paper and its figures

[`docs/article.tex`](docs/article.tex) is the paper announcing the archive. Nothing in
it that the software can produce is produced by hand:

- **The screenshots are the goldens of [`e2e/figures.spec.ts`](e2e/figures.spec.ts)**,
  kept in `e2e/figures/` and included by the article through `\graphicspath`. They are
  compared pixel for pixel on every pull request, so they are also the visual
  regression suite: a style change that leaks into another component — which has
  happened, and which no other test caught — now fails.
- **The validation table is printed by
  [`src/basic/validation.test.ts`](src/basic/validation.test.ts).** Change the
  software, rerun the test, copy the diagnostics. Do not edit the numbers.

A pixel golden is only meaningful in the environment that made it. The figures run in
the `Containerfile` image on arm64: locally under `make test`, and in CI in the
`figures` job, on an arm64 runner, from the same file. The `check` job's stock Ubuntu
runner skips them — its fonts differ, and every figure would fail on text alone.

```sh
make figures           # compare against the goldens
make figures-update    # rewrite them — then look at every changed PNG before committing
make article           # build docs/article.pdf
```

A failing figure is a question, not an obstacle: either the change was meant to alter
what the workbench looks like, in which case regenerate and review the images, or it
was not, in which case it is a bug. CI uploads the expected, actual and diff PNGs as
the `figure-diffs` artifact. If the goldens fail locally but pass in CI, the local
image is stale; `make image` rebuilds it.

`e2e/figures.css` is applied only while a figure is captured, and holds what must be
stilled for two runs to match: Monaco's own blinking cursor, and the sidebar's sticky
titles, whose text Chromium antialiased differently from run to run.
