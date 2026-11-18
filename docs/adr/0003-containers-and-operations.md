# 0003 – Containers and operations

Date: 2026-11-18

## Decisions

- **One Dockerfile with three targets** (`api`, `web`, `worker`) in
  `infra/docker/`, built from the repository root. The web app uses the
  standalone output of Next.js; API and worker run their compiled `dist`.
- **`infra/docker/compose.yaml`** runs the whole stack (database, migration,
  API, worker, web) for a test server or a local check. The existing
  `infra/compose.yaml` stays the database-only setup for development.
- **Database roles per environment** come from `infra/scripts/create-roles.sql`:
  `hv_owner` owns the schema and runs migrations, `hv_login` is what the
  applications connect as (member of `hv_app` and `hv_auth` only), `hv_backup`
  reads everything for dumps. Row-level security is forced on every table, so
  dumps need a role that bypasses it; that role can change nothing.
- **Backups** with `infra/scripts/backup.sh`, proven by
  `infra/scripts/restore-check.sh`, which restores into a scratch database and
  checks the ledger and the security settings.
- **`docs/OPERATIONS.md`** describes running an environment. It is added to
  the documents allowed under `docs/`.
- **The worker runs scheduled jobs in its own process** with a simple timer and
  a database advisory lock per job, so several worker instances never run a job
  twice. ADR 0001 proposed pg-boss as a queue; it is not needed while jobs are
  periodic and idempotent. Revisit when jobs are triggered by events (sending
  e-mails, rendering PDFs).

## Not decided

- Hosting provider, domain, TLS termination: waiting for the test server.
- Off-site storage of backups.
