#!/bin/bash
# Make the copy of this worktree's tree that the live runs are started from.
#
# Why a copy: on the development profile the door's two containers (egress, egress-host) mount the builder's own
# folder read-only at /builder and start with `node --import tsx`. In this worktree builder/node_modules is a link
# to an installed copy OUTSIDE the folder; inside a container that link leads nowhere, so the door does not start
# (measurements/M0-why-a-copy.txt). The copy made here has node_modules as real folders: a copy of the installed
# ones the worktree links to. Nothing is fetched from the network, and the worktree's links are left as they are.
#
# Usage: make-run-copy.sh <worktree> <commit | "worktree"> <destination folder>
#   <commit>    the tree of that commit, made with `git archive` (what the kept evidence runs use);
#   "worktree"  the working tree as it is now, uncommitted changes included (for trying things out only).
set -euo pipefail
WT=$1; WHAT=$2; DEST=$3
case "$DEST" in */scratchpad/*) ;; *) echo "the destination must be inside a scratchpad folder" >&2; exit 2;; esac
# After the review of 14 Nov 2026: the destination is removed first (rm -rf), and every session's folders on this
# machine are inside a scratchpad folder, so that guard alone would let this remove another session's folder. The
# destination's last part must be one of the names this change's own scripts use.
case "$(basename "$DEST")" in run06c|copy|try06c) ;; *) echo "the destination's last part must be run06c, copy or try06c (this change's own names); nothing was removed" >&2; exit 2;; esac
rm -rf "$DEST"; mkdir -p "$DEST"
if [ "$WHAT" = worktree ]; then
  (cd "$WT" && git ls-files -co --exclude-standard -z | tar --null -T - -cf -) | tar -x -C "$DEST"
else
  git -C "$WT" archive "$WHAT" | tar -x -C "$DEST"
fi
cp -a "$(readlink -f "$WT/builder/node_modules")" "$DEST/builder/node_modules"
cp -a "$(readlink -f "$WT/builder/runner/node_modules")" "$DEST/builder/runner/node_modules"
echo "copy of $WHAT made in $DEST; builder/node_modules there is a real folder ($(du -sh "$DEST/builder/node_modules" | cut -f1))"
