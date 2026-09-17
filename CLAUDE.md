# CLAUDE.md

**[AGENTS.md](AGENTS.md) is the canonical standard for this repository. Read it first.**

Everything there applies to Claude Code: the stack, the container workflow, the
component conventions, the checks, and the contribution rules. This file deliberately
does **not** restate them — two copies of a standard drift apart, and then neither can
be trusted. Add new standards to `AGENTS.md`, not here.

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

## Changing the language

A new statement or function is three edits, and the middle one is not optional:

1. the dispatch in `exec()` or the `FUNCS` table, in
   [`src/basic/interpreter.ts`](src/basic/interpreter.ts);
2. a test in [`interpreter.test.ts`](src/basic/interpreter.test.ts) that runs a
   listing and asserts on what it printed;
3. the keyword list in [`basic-language.ts`](src/basic/basic-language.ts) — move the
   word from `PLANNED` to `KEYWORDS` — and the support table in the README.
