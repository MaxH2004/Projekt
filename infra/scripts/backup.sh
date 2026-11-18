#!/usr/bin/env bash
# Writes a compressed dump of the database to the given directory, named by
# time. Run regularly (e.g. daily from cron) and copy the file off the
# machine; see docs/operations.md.
#
#   DATABASE_URL=postgres://hv_backup:...@host/hv backup.sh /var/backups/hv
#
# Connect as hv_backup (infra/scripts/create-roles.sql): it reads all rows
# despite row-level security, and can change nothing.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
target="${1:?usage: backup.sh <directory>}"
mkdir -p "$target"
file="$target/hv-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-password --file="$file" "$DATABASE_URL"
echo "$file"
