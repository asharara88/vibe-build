#!/usr/bin/env bash
# Measures, on this machine, the Docker and Compose behaviours package 0.5 relies on.
# Docker's own documentation (docs.docker.com) could not be read from the session that wrote this,
# so these are recorded as measurements (docs/SOURCES.md). Made-up values only; nothing is pushed or pulled.
# Usage: bash measure-docker-behaviours.sh  (needs the local images alpine:3.20; npm registry access for item 6)
set -u
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
EMPTY="$W/empty-client"; mkdir -p "$EMPTY"
D() { env -i PATH="$PATH" HOME="$W" DOCKER_CONFIG="$EMPTY" docker "$@"; }
MADE_UP="http://made-up-proxy.invalid:3128"

echo "== Versions"
D version --format 'Docker client {{.Client.Version}}, server {{.Server.Version}}'
D compose version

echo
echo "== 1. A predefined proxy build argument reaches RUN steps; it is in the image history only if declared"
mkdir -p "$W/b1" "$W/b2"
printf 'FROM alpine:3.20\nRUN echo "proxy seen by the build step: ${HTTPS_PROXY:+yes}"\n' > "$W/b1/Dockerfile"
printf 'FROM alpine:3.20\nARG HTTPS_PROXY\nRUN echo "proxy seen by the build step: ${HTTPS_PROXY:+yes}"\n' > "$W/b2/Dockerfile"
for v in b1 b2; do
  D build -q --no-cache -t "measure05-$v" --build-arg HTTPS_PROXY="$MADE_UP" "$W/$v" >/dev/null 2>&1 || echo "build $v failed"
done
echo "build step output lines saying the proxy was seen (not declared): $(D build --no-cache --progress=plain -t measure05-b1-plain --build-arg HTTPS_PROXY="$MADE_UP" "$W/b1" 2>&1 | grep -c 'proxy seen by the build step: yes$')"
echo "not declared: history lines holding the made-up proxy: $(D history --no-trunc measure05-b1 | grep -c "$MADE_UP")"
echo "declared with ARG: history lines holding the made-up proxy: $(D history --no-trunc measure05-b2 | grep -c "$MADE_UP")"
D image rm -f measure05-b1 measure05-b2 measure05-b1-plain >/dev/null

echo
echo "== 2. A 'proxies' entry in the Docker client configuration is added to every container's environment"
P="$W/proxied-client"; mkdir -p "$P"
printf '{"proxies":{"default":{"httpProxy":"%s","httpsProxy":"%s"}}}\n' "$MADE_UP" "$MADE_UP" > "$P/config.json"
echo "client configuration with proxies: proxy names inside: $(env -i PATH="$PATH" HOME="$W" DOCKER_CONFIG="$P" docker run --rm alpine:3.20 env | grep -ci proxy)"
echo "empty client configuration: proxy names inside: $(D run --rm alpine:3.20 env | grep -ci proxy)"

echo
echo "== 3. Compose fills in \${NAME} inside environment values and secrets-file values, from its own environment; \$\$ is a literal \$"
mkdir -p "$W/c3"
printf 'Y=from-env-file-${MADE_UP_NAME}\n' > "$W/c3/app.env"
cat > "$W/c3/compose.yaml" <<'YAML'
services:
  s:
    image: alpine:3.20
    env_file: ["./app.env"]
    environment:
      X: "from-environment-${MADE_UP_NAME}"
      Z: "literal-$${MADE_UP_NAME}"
YAML
env -i PATH="$PATH" HOME="$W" DOCKER_CONFIG="$EMPTY" MADE_UP_NAME=filled docker compose -f "$W/c3/compose.yaml" run --rm -T s sh -c 'echo "X = $X"; echo "Y = $Y"; echo "Z = $Z"' 2>/dev/null
env -i PATH="$PATH" HOME="$W" DOCKER_CONFIG="$EMPTY" docker compose -f "$W/c3/compose.yaml" down >/dev/null 2>&1

echo
echo "== 4. Profiles: naming a service starts it; a one-off run is removed only by 'down' with both the profile and --remove-orphans"
mkdir -p "$W/c4"
cat > "$W/c4/compose.yaml" <<'YAML'
name: measure05p
services:
  tools:
    image: alpine:3.20
    profiles: ["tools"]
    command: ["sleep", "60"]
YAML
D compose -f "$W/c4/compose.yaml" --dry-run up -d tools 2>&1 | grep -c "Started" | sed 's/^/dry run of "up -d tools": lines saying Started: /'
left() { D ps -aq --filter label=com.docker.compose.project=measure05p | wc -l; }
for flags in "down" "down --remove-orphans" "--profile tools down" "--profile tools down --remove-orphans"; do
  D compose -f "$W/c4/compose.yaml" run -d tools sleep 60 >/dev/null 2>&1
  D compose -f "$W/c4/compose.yaml" $flags >/dev/null 2>&1
  echo "a one-off run, then 'docker compose $flags': containers left: $(left)"
  D ps -aq --filter label=com.docker.compose.project=measure05p | xargs -r docker rm -f >/dev/null
done
D compose -f "$W/c4/compose.yaml" --profile tools down --remove-orphans >/dev/null 2>&1

echo
echo "== 5. CLI plugins are found in a system folder even with an empty client configuration"
D info --format '{{range .ClientInfo.Plugins}}{{.Name}} {{.Path}}{{"\n"}}{{end}}' | grep -E "^(compose|buildx) "

echo
echo "== 6. drizzle-kit 0.31.11 loads a .env file by itself (read in the published package)"
( cd "$W" && npm pack drizzle-kit@0.31.11 --silent >/dev/null 2>&1 && tar -xzf drizzle-kit-0.31.11.tgz && echo "bin.cjs lines that load dotenv/config: $(grep -c 'dotenv/config' package/bin.cjs)" ) || echo "could not fetch the package"
