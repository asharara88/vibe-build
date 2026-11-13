#!/bin/sh
# Install exactly the Ubuntu packages named in a list, at the versions named, and fail the image
# build if apt adds, changes or removes anything else (package 3.1; the owner's approval of the 119
# Ubuntu packages at the licence inventory's versions, docs/DECISIONS.md, 13 Nov 2026).
#
# Usage: install-exactly.sh <list>, one "name=version" per line.
#
# The list is the approved list (builder/runner/approved-*.txt, taken from
# docs/licences/raw/ubuntu-runner-packages.tsv). apt is asked for each package at its version; a
# version it cannot find stops the install. Then the image's whole package list is compared with the
# list from before the install: what was added must be exactly the approved list, and nothing that
# was there before may have changed or gone. Any difference is printed and the build fails.
set -eu
list="$1"
sort -u "$list" > /tmp/pkgs-wanted
dpkg-query -W -f='${Package}=${Version}\n' | sort > /tmp/pkgs-before
DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends $(cat /tmp/pkgs-wanted)
dpkg-query -W -f='${Package}=${Version}\n' | sort > /tmp/pkgs-after
comm -13 /tmp/pkgs-before /tmp/pkgs-after > /tmp/pkgs-added
comm -23 /tmp/pkgs-before /tmp/pkgs-after > /tmp/pkgs-gone
if cmp -s /tmp/pkgs-added /tmp/pkgs-wanted && [ ! -s /tmp/pkgs-gone ]; then
  echo "PACKAGE CHECK PASSED ($list): apt added exactly the $(wc -l < /tmp/pkgs-wanted) approved packages, each at its approved version; no package already in the image changed or went."
  rm -f /tmp/pkgs-*
  exit 0
fi
echo "PACKAGE CHECK FAILED ($list): apt did not install exactly the approved packages at the approved versions."
echo "Added, and not on the approved list at that version:"
comm -23 /tmp/pkgs-added /tmp/pkgs-wanted | sed 's/^/  /'
echo "On the approved list, and not added at that version:"
comm -13 /tmp/pkgs-added /tmp/pkgs-wanted | sed 's/^/  /'
echo "Already in the image, and changed or removed:"
sed 's/^/  /' /tmp/pkgs-gone
exit 1
