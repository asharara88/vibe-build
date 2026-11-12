#!/usr/bin/env bash
# Development-machine only: create the local PostgreSQL role and databases the builder uses.
# Uses the Unix socket with peer authentication, so there is no password anywhere.
set -euo pipefail
service postgresql status >/dev/null 2>&1 || service postgresql start
ROLE="$(id -un)"
su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='$ROLE'\"" | grep -q 1 || su postgres -c "psql -c \"create role \\\"$ROLE\\\" login createdb\""
for db in builder_dev builder_test; do
  su postgres -c "psql -tAc \"select 1 from pg_database where datname='$db'\"" | grep -q 1 || su postgres -c "createdb -O $ROLE $db"
done
echo "Databases ready: builder_dev, builder_test (owner $ROLE, peer auth over /var/run/postgresql)"
