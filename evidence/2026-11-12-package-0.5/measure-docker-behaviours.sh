#!/usr/bin/env bash
# Measures, on this machine, the Docker and Compose behaviours package 0.5 relies on.
# Docker's own documentation (docs.docker.com) could not be read from the session that wrote this,
# so these are recorded as measurements (docs/SOURCES.md). Made-up values only; nothing is pushed or pulled.
# Usage, from the repository root: bash evidence/2026-11-12-package-0.5/measure-docker-behaviours.sh
# (needs the local image alpine:3.20; npm registry access for item 6)
set -u
REPO=$(cd "$(dirname "$0")/../.." && pwd)
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
left() { D ps -aq --filter label=com.docker.compose.project=measure05p | wc -l; }
D compose -f "$W/c4/compose.yaml" up -d tools >/dev/null 2>&1
echo "'up -d tools', without --profile, the service being under the profile 'tools' only: containers running: $(D ps -q --filter label=com.docker.compose.project=measure05p --filter status=running | wc -l)"
D compose -f "$W/c4/compose.yaml" --profile tools down --remove-orphans >/dev/null 2>&1
echo "then '--profile tools down --remove-orphans': containers left: $(left)"
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
echo "== 6. drizzle-kit 0.31.11 loads a .env file by itself when it starts (read in the published package)"
( cd "$W" && npm pack drizzle-kit@0.31.11 --silent >/dev/null 2>&1 && tar -xzf drizzle-kit-0.31.11.tgz && {
  echo "bin.cjs: where require_main is defined, and the module it is:"
  grep -n -A1 '^var require_main = ' package/bin.cjs
  echo "bin.cjs lines that call dotenv's config(), require_main().config(: $(grep -c 'require_main().config(' package/bin.cjs)"
  echo "the call, with the two lines before it:"
  grep -n -B2 'require_main().config(' package/bin.cjs
} ) || echo "could not fetch the package"

echo
echo "== 7. 'docker context use' records the choice as currentContext in config.json under DOCKER_CONFIG; DOCKER_HOST is used over it"
C="$W/context-client"; mkdir -p "$C"
DC() { env -i PATH="$PATH" HOME="$W" DOCKER_CONFIG="$C" "$@"; }
DC docker context create measure05-made-up --docker host=unix:///var/run/docker.sock >/dev/null 2>&1 || echo "context create failed"
DC docker context use measure05-made-up >/dev/null 2>&1
echo "config.json under DOCKER_CONFIG after 'docker context use measure05-made-up': $(grep -o '"currentContext": *"[^"]*"' "$C/config.json")"
echo "context Docker uses, DOCKER_HOST not set: $(DC docker context show 2>/dev/null)"
echo "context Docker uses, DOCKER_HOST set (to the default socket): $(DC DOCKER_HOST=unix:///var/run/docker.sock docker context show 2>/dev/null)"
echo "context Docker uses, DOCKER_CONTEXT=default: $(DC DOCKER_CONTEXT=default docker context show 2>/dev/null)"
DC docker context use default >/dev/null 2>&1
DC docker context rm measure05-made-up >/dev/null 2>&1
echo "after 'docker context use default' and 'docker context rm': config.json lines naming the made-up context: $(grep -c measure05-made-up "$C/config.json"); made-up contexts left: $(DC docker context ls -q | grep -c measure05)"

echo
echo "== 8. cliPluginsExtraDirs in the client's config.json adds a plugin folder"
X="$W/extra-plugins"; E="$W/extra-client"; mkdir -p "$X" "$E"
cat > "$X/docker-measurestub" <<'SH'
#!/bin/sh
if [ "$1" = docker-cli-plugin-metadata ]; then
  echo '{"SchemaVersion":"0.1.0","Vendor":"made-up","Version":"0.0.1","ShortDescription":"made-up stub plugin"}'
else
  echo "made-up stub plugin ran"
fi
SH
chmod +x "$X/docker-measurestub"
printf '{"cliPluginsExtraDirs":["%s"]}\n' "$X" > "$E/config.json"
DE() { env -i PATH="$PATH" HOME="$W" DOCKER_CONFIG="$E" docker "$@"; }
echo "config.json naming the stub's folder in cliPluginsExtraDirs: plugins found named measurestub: $(DE info --format '{{range .ClientInfo.Plugins}}{{.Name}}{{"\n"}}{{end}}' | grep -c '^measurestub$'); 'docker measurestub' prints: $(DE measurestub 2>&1)"
echo "empty client configuration: plugins found named measurestub: $(D info --format '{{range .ClientInfo.Plugins}}{{.Name}}{{"\n"}}{{end}}' | grep -c '^measurestub$')"

echo
echo "== 9. The template's .dockerignore keeps .env and .env.local out of the build context, and keeps .env.example"
B9="$W/b9"; mkdir -p "$B9"
cp "$REPO/templates/next/.dockerignore" "$B9/.dockerignore"
for f in .env .env.local .env.example made-up-app-file.txt; do echo "MADE_UP_SETTING=made-up" > "$B9/$f"; done
printf 'FROM alpine:3.20\nCOPY . /ctx/\n' > "$B9/Dockerfile"
echo "files in the scratch context: $(cd "$B9" && ls -A | paste -sd ' ' -)"
D build -q --no-cache -t measure05-b9 "$B9" >/dev/null 2>&1 || echo "build b9 failed"
echo "files that reached the image: $(D run --rm measure05-b9 ls -A /ctx | paste -sd ' ' -)"
D image rm -f measure05-b9 >/dev/null

echo
echo "== 10. HTTP_PROXY, like HTTPS_PROXY (item 1), reaches RUN steps when not declared, and is then not in the image history"
mkdir -p "$W/b10"
printf 'FROM alpine:3.20\nRUN echo "proxy seen by the build step: ${HTTP_PROXY:+yes}"\n' > "$W/b10/Dockerfile"
echo "build step output lines saying the proxy was seen (not declared): $(D build --no-cache --progress=plain -t measure05-b10 --build-arg HTTP_PROXY="$MADE_UP" "$W/b10" 2>&1 | grep -c 'proxy seen by the build step: yes$')"
echo "not declared: history lines holding the made-up proxy: $(D history --no-trunc measure05-b10 | grep -c "$MADE_UP")"
D image rm -f measure05-b10 >/dev/null
