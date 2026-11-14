#!/bin/bash
# vibe-build: make Docker startable and fetch the two sandbox images the owner approved,
# each at its exact digest (builder/approved-images.json; question 18 (a), 13 Nov 2026).
# Every step may fail and every wait has a time limit, so the script cannot stop a
# session starting or hold it up for long. It leaves Docker stopped with no stale
# process files, and writes one dated line per outcome to /var/log/vibe-build-setup.log.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
log=/var/log/vibe-build-setup.log
note() { echo "$(date -u +%FT%TZ) $*" >>"$log"; }
clean_pids() {
  pgrep -x dockerd >/dev/null && return 0
  rm -f /var/run/docker.pid /var/run/docker-ssd.pid /run/docker/containerd/containerd.pid
}
note "setup start"

# Docker's start script aborts when it may not raise its limits. Let it carry on instead.
sed -i '/^\s*ulimit .*[^e]$/ s/$/ || true/' /etc/init.d/docker || true

clean_pids
service docker start || true
timeout 30 bash -c 'until docker info >/dev/null 2>&1; do sleep 1; done'

fetch() {
  timeout -k 5 40 docker pull -q "$1" >/dev/null 2>&1 \
    || { sleep 60; timeout -k 5 40 docker pull -q "$1" >/dev/null 2>&1; }
  rc=$?
  [ "$rc" -eq 0 ] && docker tag "$1" "${1%@*}"
  note "$1 exit=$rc"
}
if timeout 10 docker info >/dev/null 2>&1; then
  fetch node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 &
  fetch postgres:16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139 &
  wait
else
  note "docker did not answer; nothing fetched"
fi

if pgrep -x dockerd >/dev/null; then service docker stop || true; fi
clean_pids
note "setup end"
exit 0
