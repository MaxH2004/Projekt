#!/usr/bin/env bash
# Restores a dump into a fresh scratch database and checks it, then drops it.
# Proves that backups can actually be restored. Needs a superuser connection
# to the same cluster (or one where infra/scripts/create-roles.sql has run).
#
#   ADMIN_URL=postgres://postgres:...@host/postgres restore-check.sh hv-20261118T120000Z.dump
#
# Triggers stay off while loading: the ledger accepts lines only in the
# transaction of their entry, and the audit log would record every row again.
# The checks below make up for that.
set -euo pipefail
: "${ADMIN_URL:?ADMIN_URL must be set}"
dump="${1:?usage: restore-check.sh <dump file>}"
scratch="hv_restore_check_$(date -u +%s)"
scratch_url="${ADMIN_URL%/*}/$scratch"

psql "$ADMIN_URL" -qc "CREATE DATABASE $scratch"
trap 'psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $scratch"' EXIT

pg_restore --dbname="$scratch_url" --disable-triggers --exit-on-error "$dump"

check() {
  local name="$1" sql="$2" result
  result="$(psql "$scratch_url" -Atc "$sql")"
  if [ "$result" != "0" ]; then
    echo "FAILED: $name ($result)" >&2
    exit 1
  fi
  echo "ok: $name"
}

check "migrations recorded" "SELECT CASE WHEN count(*) > 0 THEN 0 ELSE 1 END FROM schema_migration"
check "every journal entry balances" \
  "SELECT count(*) FROM (SELECT entry_id FROM journal_line GROUP BY entry_id HAVING sum(amount_cents) <> 0) unbalanced"
check "no journal entry without lines" \
  "SELECT count(*) FROM journal_entry e WHERE NOT EXISTS (SELECT FROM journal_line l WHERE l.entry_id = e.id)"
check "row-level security forced on every table" \
  "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migration' AND NOT (relrowsecurity AND relforcerowsecurity)"
check "triggers enabled again" \
  "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled = 'D'"

psql "$scratch_url" -At -c "SELECT 'organizations: ' || count(*) FROM organization" -c "SELECT 'journal entries: ' || count(*) FROM journal_entry" -c "SELECT 'audit entries: ' || count(*) FROM audit_log"
echo "restore check passed"
