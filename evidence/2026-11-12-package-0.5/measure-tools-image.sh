#!/usr/bin/env bash
# Builds the template's tools image the way the sandbox manager does on the development profile (the
# session proxy and its certificate passed in), then counts, without printing it, where the proxy's
# address appears, and lists the certificate files in the image. The image is removed afterwards.
# Usage (from the repository root): bash evidence/2026-11-12-package-0.5/measure-tools-image.sh
set -u
: "${HTTPS_PROXY:?the session proxy (HTTPS_PROXY) must be set}"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
EMPTY="$W/empty-client"; mkdir -p "$EMPTY" "$W/ctx"
D() { env -i PATH="$PATH" HOME="$W" DOCKER_CONFIG="$EMPTY" docker "$@"; }
(cd templates/next && tar --exclude=node_modules --exclude=.next -cf - .) | (cd "$W/ctx" && tar -xf -)
mkdir -p "$W/ctx/certs" && cp /root/.ccr/ca-bundle.crt "$W/ctx/certs/session-ca.crt"
if D build -q --network host --target tools -t measure05-tools \
  --build-arg HTTPS_PROXY="$HTTPS_PROXY" --build-arg HTTP_PROXY="$HTTPS_PROXY" --build-arg NODE_EXTRA_CA_CERTS=/certs/session-ca.crt \
  "$W/ctx" >/dev/null 2>"$W/err"; then
  echo "tools image built from templates/next at $(git rev-parse --short HEAD)"
  echo "history lines: $(D history --no-trunc measure05-tools | tail -n +2 | wc -l)"
  echo "history lines holding the proxy's address: $(D history --no-trunc measure05-tools | grep -cF "$HTTPS_PROXY")"
  echo "image settings (inspect) lines holding it: $(D image inspect measure05-tools | grep -cF "$HTTPS_PROXY")"
  echo "image's declared settings: $(D image inspect measure05-tools --format '{{range .Config.Env}}{{.}} {{end}}' | tr ' ' '\n' | cut -d= -f1 | grep . | sort | tr '\n' ' ')"
  echo "user: $(D image inspect measure05-tools --format '{{.Config.User}}'), start-up script: $(D image inspect measure05-tools --format '{{json .Config.Entrypoint}}')"
  echo "session certificate files in the image: $(D run --rm measure05-tools sh -c 'ls /certs/session-ca.crt /app/certs/session-ca.crt 2>/dev/null' | tr '\n' ' ')"
  echo "a .env file in /app: $(D run --rm measure05-tools sh -c 'ls -a /app | grep -cx .env')"
  D image rm -f measure05-tools >/dev/null
else
  echo "build FAILED"; tail -5 "$W/err"
fi
