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

.PHONY: help start image install dev build preview typecheck test-unit test check clean

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

clean: ## Remove build output and dependencies
	rm -rf node_modules dist .vite playwright-report test-results
