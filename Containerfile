# The host is not assumed to have Node. Everything — npm, Vite, tsc, Playwright —
# runs in here, driven by the Makefile.
ARG NODE_VERSION=26
FROM node:${NODE_VERSION}-slim

WORKDIR /app

ENV CI=true
ENV NODE_OPTIONS=--max-old-space-size=3072

# Chromium and its system libraries, baked into the image. The version here and
# the @playwright/test version in package.json are ONE version and must move
# together: the browser build lives in this image, which package-lock.json does
# not govern, so a caret in package.json could float the test runner ahead of the
# browser it was built against. That fails as
#   Executable doesn't exist at .../chromium_headless_shell-XXXX/...
# which reads like a broken suite and is really a version skew.
RUN apt-get update && \
    npx -y playwright@1.63.0 install chromium --with-deps && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

CMD ["bash"]
