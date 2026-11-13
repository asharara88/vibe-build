# The acceptance runner's image (package 3.1; design: docs/design/package-3.1.md, section 3, "route B").
#
# Approved by the owner on 13 Nov 2026 for the builder's internal development and testing only
# (question 15 (a) and question 11 (a), docs/DECISIONS.md; builder/approved-images.json):
# ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5
# and node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee,
# each pinned by digest; Node and npm copied from the second, with Node's licence notice; the Ubuntu
# packages at the licence inventory's versions (docs/licences/runtime-inventory.md, section 2); and
# Chrome for Testing's headless shell 153.0.8010.12, exactly the zip with the SHA-256 below, unchanged,
# its ABOUT and LICENSE.headless_shell kept. No video is played or recorded (the runner's configuration
# turns Playwright's video off, and Playwright's video tool, ffmpeg, is not installed). The image is
# built on the builder's machine and kept there: it is never pushed to a registry or given to anyone.
#
# Built only by builder/src/acceptance/runner-image.ts, from a build folder it assembles: this folder's
# files, browser/chrome-headless-shell-linux64.zip (taken from the browser cache, checked by SHA-256
# first), and certs/ (the cloud session's certificate when there is one, otherwise empty). The
# certificate is only bind-mounted into the steps that download, never copied into a layer.

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS node

# Unpack stage: the zip is checked again here, against the pinned SHA-256, and unpacked as it is.
# unzip is installed at its approved version, exactly. Only the browser's folder leaves this stage.
FROM ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5 AS unpack
COPY apt-session.sh install-exactly.sh approved-unpack-packages.txt /build/
RUN --mount=type=bind,source=certs,target=/certs \
    --mount=type=bind,source=browser,target=/browser \
    sh /build/apt-session.sh on && \
    sh /build/install-exactly.sh /build/approved-unpack-packages.txt && \
    sh /build/apt-session.sh off && \
    echo "a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d  /browser/chrome-headless-shell-linux64.zip" | sha256sum -c - && \
    mkdir -p /ms-playwright/chromium_headless_shell-1243 && \
    unzip -q /browser/chrome-headless-shell-linux64.zip -d /ms-playwright/chromium_headless_shell-1243 && \
    touch /ms-playwright/chromium_headless_shell-1243/INSTALLATION_COMPLETE && \
    cd /ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64 && \
    sha256sum chrome-headless-shell ABOUT LICENSE.headless_shell

FROM ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
# Node's licence notice, which the owner's approval asks the image to carry.
COPY --from=node /usr/local/LICENSE /usr/local/LICENSE
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_PATH=/runner/node_modules \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /runner
COPY package.json package-lock.json apt-session.sh install-exactly.sh approved-runner-packages.txt /build/
# Playwright Test from the runner's own lock file (its licences are checked by `npm run check:licences`
# in builder/), then the approved Ubuntu packages, exactly; then Playwright's own list of what its
# headless shell needs is checked against what is installed ("All system dependencies are installed").
RUN --mount=type=bind,source=certs,target=/certs \
    cp /build/package.json /build/package-lock.json /runner/ && \
    if [ -f /certs/session-ca.crt ]; then CAFILE="--cafile /certs/session-ca.crt"; else CAFILE=""; fi && \
    npm ci --omit=dev --ignore-scripts --no-fund --no-audit $CAFILE && \
    sh /build/apt-session.sh on && \
    sh /build/install-exactly.sh /build/approved-runner-packages.txt && \
    ./node_modules/.bin/playwright install-deps --dry-run chromium-headless-shell && \
    sh /build/apt-session.sh off && \
    rm -rf /root/.npm /build
COPY --from=unpack /ms-playwright /ms-playwright
COPY playwright.config.mjs /runner/playwright.config.mjs
RUN useradd -m -u 1001 runner
USER runner
