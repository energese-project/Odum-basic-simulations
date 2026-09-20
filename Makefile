IMAGE_APP     := odum-basic
CONTAINER_BIN := container
NODE_VERSION  := $(shell cat .node-version)
WORKDIR       := /app

# Apple `container` defaults to 1 GiB, and the Containerfile tells Node it may
# use a 3 GiB heap. Node believes it, grows past the cgroup and is OOM-killed —
# which surfaces as `net::ERR_CONNECTION_REFUSED` from Playwright, i.e. a dead
# dev server rather than anything resembling an out-of-memory message. The
# Playwright run is the peak: two Vite servers, a production build and Chromium
# at once. Keep this comfortably above the Containerfile's max-old-space-size.
MEMORY        := 6g
CPUS          := 4

RUN           := $(CONTAINER_BIN) run --rm --init -m $(MEMORY) -c $(CPUS) \
	-v $(shell pwd):$(WORKDIR) $(IMAGE_APP)

.PHONY: help start image install dev build preview typecheck test-unit test check clean \
        figures figures-update article attest attest-update wasm wasm-check

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# --------------------------------------------------
# Container daemon and image
# --------------------------------------------------

start: ## Start the Apple container system daemon
	$(CONTAINER_BIN) system start

image: start ## Build the dev image (node:$(NODE_VERSION)-slim + Chromium)
	$(CONTAINER_BIN) build -f Containerfile -t $(IMAGE_APP) --build-arg NODE_VERSION=$(NODE_VERSION) .

# --------------------------------------------------
# Development
# --------------------------------------------------

install: start ## Install npm dependencies inside the container
	$(RUN) npm install

# The app is served under BASE_PATH, in dev as well as in production, so that
# import.meta.env.BASE_URL is one value everywhere and the router never has to
# guess. http://localhost:5173/ redirects to it.
dev: start ## Vite dev server on :5173/Odum-basic-simulations/
	$(CONTAINER_BIN) run --rm -it --init -m $(MEMORY) -c $(CPUS) -p 5173:5173 \
		-v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm run dev

build: start ## Build the static site into dist/
	$(RUN) npm run build

preview: start ## Serve the built site on :4173/Odum-basic-simulations/
	$(CONTAINER_BIN) run --rm -it --init -m $(MEMORY) -c $(CPUS) -p 4173:4173 \
		-v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm run preview

# --------------------------------------------------
# Checks — the same three CI runs
# --------------------------------------------------

typecheck: start ## tsc --noEmit
	$(RUN) npm run typecheck

test-unit: start ## Unit tests (node --test, straight on the TypeScript source)
	$(RUN) npm test

test: start ## Playwright end-to-end tests, dev server and built bundle
	$(RUN) npm run e2e

check: typecheck test-unit test ## Everything CI runs. Must pass before pushing.

# --------------------------------------------------
# The paper's figures
#
# e2e/figures.spec.ts screenshots the built site and compares it against the
# goldens in e2e/figures/, which docs/article.tex includes. `make test` already
# runs it; this target runs it alone. The goldens are pixel comparisons, only
# valid in this image on arm64 — the CI `figures` job builds the same one.
# --------------------------------------------------

figures: start ## Compare the paper's figures against their goldens
	$(RUN) npm run e2e -- --project=figures

figures-update: start ## Rewrite the figure goldens. Look at the PNGs before committing
	$(RUN) npm run e2e -- --project=figures --update-snapshots

# --------------------------------------------------
# The oracle attestation
#
# validation/oracle/ runs Odum (1989) Table 3 in our interpreter and in PC-BASIC,
# a GW-BASIC emulator kept in its own image (GPL-3.0), and records every result
# in SHA256SUMS. The article's oracle table and numbers come from it. `attest`
# regenerates everything and fails on any byte that differs from the record;
# `attest-update` rewrites the record — then look at the diff before committing.
# Needs neither this repository's image nor Node on the host.
# --------------------------------------------------

attest: start ## Rerun the oracle comparison and check it against its record
	CONTAINER_BIN=$(CONTAINER_BIN) validation/oracle/attest.sh

attest-update: start ## Rerun the oracle comparison and rewrite its record
	CONTAINER_BIN=$(CONTAINER_BIN) validation/oracle/attest.sh --update

# --------------------------------------------------
# The browser build of the C engine
#
# src/basic/engine.wasm is committed, because the site deploys with `npm ci &&
# npm run build` on a runner that has Node and nothing else — no emscripten, no
# containers. A committed binary can drift from the source that is supposed to
# produce it, so `wasm-check` rebuilds it and fails if a byte moved. That is the
# attestation's argument applied to a build product rather than to a result.
#
# The image is pinned by digest, and its emcc version is printed on every build
# so a future difference is attributable.
# --------------------------------------------------

wasm: start ## Rebuild src/basic/engine.wasm from engine/ in the pinned emscripten image
	CONTAINER_BIN=$(CONTAINER_BIN) engine/build-wasm.sh

wasm-check: start ## Rebuild it and fail if the committed bytes moved
	CONTAINER_BIN=$(CONTAINER_BIN) engine/build-wasm.sh --check

# pdflatex on the host if there is one; otherwise the container shim this machine
# uses. Twice, because \ref and \cite resolve from the first run's .aux.
PDFLATEX ?= $(shell command -v pdflatex || command -v pdflatex-container)

article: ## Build docs/article.pdf from docs/article.tex and the figure goldens
	@test -n "$(PDFLATEX)" || { echo "pdflatex not found"; exit 1; }
	cd docs && $(PDFLATEX) -interaction=nonstopmode -halt-on-error article.tex >/dev/null
	cd docs && $(PDFLATEX) -interaction=nonstopmode -halt-on-error article.tex | grep -E "^Output|Warning" || true

clean: ## Remove build output and dependencies
	rm -rf node_modules dist .vite playwright-report test-results
