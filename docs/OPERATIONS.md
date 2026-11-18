# Operations

How to run an environment (test server, later production). Decisions behind
it are in `docs/adr/0003-containers-and-operations.md`.

## Parts

| Part | Image target | Connects as | Notes |
| --- | --- | --- | --- |
| Database | `postgres:16` | – | Needs the extension `btree_gist`. |
| Migration | `migrate` | `hv_owner` | Runs once per deployment, before the API starts. |
| API | `api` | `hv_login` | Port 3001, `GET /health` answers 503 without database. |
| Worker | `worker` | `hv_login` | Scheduled jobs; any number of instances. |
| Web interface | `web` | – (talks to the API) | Port 3000. The only part reachable from outside, behind HTTPS. |

## First setup of a database

1. Create the database and run `infra/scripts/create-roles.sql` as a
   superuser, with three passwords (`owner_password`, `app_password`,
   `backup_password`). Running it again sets new passwords.
2. Run the migration image (or `pnpm db:migrate`) with
   `DATABASE_URL` of `hv_owner`.

The roles:

- `hv_owner` owns the schema and runs migrations. Never used by the running
  applications.
- `hv_login` is what API and worker connect as. It holds no rights of its own;
  it switches per transaction to `hv_app` (tenant data, row-level security per
  organization) or `hv_auth` (users and sessions).
- `hv_backup` reads all rows for `pg_dump` and can change nothing. Row-level
  security is forced on every table, so even the owner sees no rows without an
  organization set; a dump needs this role.

## Configuration

| Variable | Used by | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | API, worker, migration | Connection as described above. |
| `AUTH_SECRET_KEY` | API | 32 random bytes, base64; encrypts two-factor secrets. Losing it disables every user's two-factor login. |
| `COOKIE_SECURE` | API, web | `true` unless testing over plain HTTP. |
| `TRUST_PROXY` | API | Proxies whose `X-Forwarded-For` the API believes, e.g. `loopback` or `uniquelocal`. Rate limits are keyed by the client address it yields. |
| `API_URL` | web | Where the web server reaches the API. The browser never talks to the API. |
| `HOST`, `PORT` | API | Listen address. |
| `FILE_STORAGE`, `FILE_STORAGE_DIR` | API | Uploaded files: `local` with a directory (a volume in the container), `none` to refuse uploads. `s3` is prepared but not connected. |
| `WORKER_INTERVAL_MINUTES` | worker | How often the jobs run (default 60). |

The reverse proxy in front of the web interface must set `X-Forwarded-For`;
the web server passes it on to the API.

## Whole stack with Docker Compose

```bash
cp infra/docker/.env.example infra/docker/.env
docker compose -f infra/docker/compose.yaml --env-file infra/docker/.env up --build -d
```

The database container creates the roles on first start
(`infra/docker/init-roles.sh`). Only the web interface is published, on
`127.0.0.1:${WEB_PORT}`.

## Backups

Two things need backing up: the database and the directory of uploaded files
(`FILE_STORAGE_DIR`, in Compose the volume `files`). Files are never changed
after upload, so copying new files incrementally is enough; a file without a
row in `document` can be deleted, a row without a file is a loss.

```bash
DATABASE_URL=postgres://hv_backup:...@host/hv infra/scripts/backup.sh /var/backups/hv
ADMIN_URL=postgres://postgres:...@host/postgres infra/scripts/restore-check.sh /var/backups/hv/hv-<time>.dump
```

`restore-check.sh` restores into a scratch database and checks that every
journal entry balances, that row-level security is forced everywhere and that
all triggers are enabled again; then it drops the scratch database. Run it
after every change to the backup setup and regularly, e.g. weekly. CI runs
both scripts on every push.

Restoring for real: create the roles first (`create-roles.sql`), then
`pg_restore --disable-triggers` as a superuser into an empty database.
Triggers must stay off while loading, because the ledger accepts journal lines
only in the transaction of their entry and the audit log would record every
row again.

## Checks in CI

`.github/workflows/ci.yml` runs on every push: `pnpm verify`, a dependency
audit (failing on known vulnerabilities in production dependencies), the
end-to-end tests against real servers connected as `hv_login`, backup and
restore check, and a build of all images.
