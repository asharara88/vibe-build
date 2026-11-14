#!/bin/bash
# Runs a COPY of the setup script, before (the integration branch at bdfd911) and after the fix,
# with stand-in commands that hang on purpose: `service` never returns, and `docker tag` never
# returns. Nothing real is started, stopped or changed: the copy's PATH puts the stand-ins first,
# and its log, Docker start-script and process-file paths are rewritten into a temporary folder.
# GNU timeout signals the whole process group of the copy, so a hanging stand-in it started ends with it.
# Usage: bash hang-test.sh <the script before> <the script after>
set -u
OUTER=240   # seconds; the fixed script's own worst case here is about 110
run() {
  label=$1 src=$2 T=$(mktemp -d)
  mkdir -p "$T/stubs"
  printf '#!/bin/bash\nexec sleep 300\n' > "$T/stubs/service"
  printf '#!/bin/bash\ncase "$1" in\n  info|pull) exit 0;;\n  tag) exec sleep 300;;\n  *) exit 0;;\nesac\n' > "$T/stubs/docker"
  printf '#!/bin/bash\nexit 0\n' > "$T/stubs/pgrep"   # "dockerd is running", so the stop is tried
  chmod +x "$T/stubs/"*
  echo 'ulimit -n 1048576' > "$T/init-docker"
  sed -e "s#^export PATH=#export PATH=$T/stubs:#" \
      -e "s#/var/log/vibe-build-setup.log#$T/setup.log#" \
      -e "s#/etc/init.d/docker#$T/init-docker#" \
      -e "s#/var/run/docker.pid#$T/docker.pid#; s#/var/run/docker-ssd.pid#$T/docker-ssd.pid#; s#/run/docker/containerd/containerd.pid#$T/containerd.pid#" \
      "$src" > "$T/setup-copy.sh"
  if grep -E "/var/log/|/etc/init.d/|/var/run/|/run/docker" "$T/setup-copy.sh"; then echo "REFUSED: a real path is left in the copy"; return 1; fi
  start=$(date +%s)
  timeout -k 5 $OUTER bash "$T/setup-copy.sh" >/dev/null 2>&1; rc=$?
  took=$(( $(date +%s) - start ))
  if [ $rc -eq 124 ] || [ $rc -eq 137 ]; then echo "$label: did NOT finish within $OUTER s (stopped by the test's own limit)"; else echo "$label: finished by itself in $took s, exit code $rc"; fi
  echo "  its log:"; sed 's/^/    /' "$T/setup.log" 2>/dev/null || echo "    (no log)"
  rm -rf "$T"
}
echo "Hang test, $(date -u +%FT%TZ). Stand-ins: service hangs; docker tag hangs; docker info and docker pull succeed at once."
run "BEFORE ($1)" "$1"
run "AFTER ($2)" "$2"
