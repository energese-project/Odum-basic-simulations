# CLAUDE.md

**[AGENTS.md](AGENTS.md) is the canonical standard for this repository. Read it first.**

Everything there applies to Claude Code: the stack, the container workflow, the
component conventions, the checks, and the contribution rules. This file deliberately
does **not** restate them — two copies of a standard drift apart, and then neither can
be trusted. Add new standards to `AGENTS.md`, not here.

## The two constraints on everything

Stated in full in [AGENTS.md §2](AGENTS.md#2-built-to-last). Named here because they
decide what a change is allowed to look like before any code is written:

- **Native platform first, third-party code last.** Vanilla Web Components and the
  DOM. Runtime dependencies are Monaco and Chart.js and that list stays short;
  adding one needs a stated reason in the PR. Build and test tooling is exempt.
- **Test first.** Write the failing test, then the code. A bug fix starts by
  reproducing the bug in a test.

This is an archive meant to outlive its authors. Both rules follow from that.

## The ones that get broken most

1. **There is no local Node.** `node` and `npm` are not on this host. Every command
   goes through `make` and the Apple `container` image. Do not reach for `npx`
   directly.
2. **Push *and* open a PR.** CI runs on `pull_request`. A pushed branch with no PR has
   been tested by nothing.
3. **Do not merge your own PR.** Hand over a green one.
4. **A task is done when it is merged**, not when it is written. Check `main`.
5. **`make check` before every push**, in the branch the PR will carry, so what the PR
   claims is what was actually tested.

## Verifying a visual change

`make build` proves it compiles, not that it looks right. For anything touching
layout, the chart or the editor, run `make dev` and look at it, or add a Playwright
assertion — the e2e suite runs against both the dev server and the built bundle, so an
assertion there covers the shipped artifact too.

The chart is the case where "it compiles" is furthest from "it works": a canvas that
has gone stale after a theme change renders perfectly and is simply the wrong colour.

## Adding or changing a program

`programs/<id>.bas` plus `programs/<id>.json` — see
[`programs/README.md`](programs/README.md). Never set `fidelity` for a contributor:
it is the one field that must be a deliberate human choice. When writing a worked
example yourself, it is `original`, and it has no `source`.

## Changing the language

**The full recipe is [AGENTS.md §9](AGENTS.md#9-the-language-core). Read it — this is
the rule that has been got wrong most, and getting it wrong is silent.**

The one thing to carry in your head: there are **two** implementations, and the one
named `interpreter.ts` is not the one that runs. The site executes
[`engine/`](engine/), compiled to WebAssembly. A statement added to
`src/basic/interpreter.ts` alone is invisible in the browser, and its test in
`interpreter.test.ts` passes anyway, so nothing tells you.

The order is: engine (lexer, parser, interp, validate) → a test in `engine/tests/` →
**`make wasm` and commit the artefact**, because the site loads the committed
`src/basic/engine.wasm` and not your working tree → the same statement in
`interpreter.ts` with its test, or `scripts/compare-engines.ts` stops comparing equals
→ `basic-language.ts`, moving the word from `PLANNED` to `KEYWORDS`, and the README's
support table.

Then `make attest`: the oracle comparison runs our side through both implementations,
so a language change moves it.
