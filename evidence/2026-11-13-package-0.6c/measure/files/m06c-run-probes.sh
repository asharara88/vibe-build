#!/bin/bash
# Package 0.6c, first step: runs m06c-probe.mjs inside the network of each named container (docker run
# --network container:<name>), with every capability dropped, a read-only root and an unprivileged user.
# Usage: m06c-run-probes.sh <attempts.json> <out-dir> <label=container-or-network-spec> ...
NODE=node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
F=$(cd "$(dirname "$0")" && pwd)
ATT=$(cat "$1"); OUT=$2; shift 2
for spec in "$@"; do
  label=${spec%%=*}; net=${spec#*=}
  docker run --rm --name "m06c-probe-$label" -e UV_THREADPOOL_SIZE=64 -e PROBE_LIMIT_MS=${PROBE_LIMIT_MS:-6000} --network "$net" --cap-drop ALL --security-opt no-new-privileges:true --read-only --user 1000 -v "$F:/m06c:ro" $NODE node /m06c/m06c-probe.mjs "$label" "$ATT" > "$OUT/probe-$label.jsonl" 2>&1 &
done
wait
