#!/bin/sh
# apt through the cloud session's proxy, for one build step only (package 3.1).
#   apt-session.sh on    before apt runs; apt-session.sh off    after it, in the same step.
# When the build is given the session's certificate (certs/session-ca.crt, bind-mounted for the step,
# never copied into a layer), apt is pointed at its sources over HTTPS and told to trust that
# certificate, as the measured build of 13 Nov 2026 did; "off" puts the sources back and removes the
# setting, so the finished image holds neither. Off the cloud session there is no certificate and
# nothing is changed. The package lists apt downloads are removed by "off" as well.
set -eu
src=/etc/apt/sources.list.d/ubuntu.sources
case "$1" in
  on)
    if [ -f /certs/session-ca.crt ]; then
      cp "$src" /tmp/ubuntu.sources.orig
      sed -i 's#http://#https://#g' "$src"
      echo 'Acquire::https::CAInfo "/certs/session-ca.crt";' > /etc/apt/apt.conf.d/99session-ca
    fi
    apt-get update -q
    ;;
  off)
    if [ -f /tmp/ubuntu.sources.orig ]; then
      cp /tmp/ubuntu.sources.orig "$src"
      rm -f /tmp/ubuntu.sources.orig /etc/apt/apt.conf.d/99session-ca
    fi
    rm -rf /var/lib/apt/lists/*
    ;;
  *)
    echo "usage: apt-session.sh on|off" >&2
    exit 2
    ;;
esac
