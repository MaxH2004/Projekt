# Folder structure

This structure is binding. `pnpm lint:structure` and `pnpm lint:boundaries`
check it on every CI run. A new folder on any of the levels listed below needs
a decision in `docs/adr/` and an entry in `infra/scripts/check-structure.mjs`.

```
apps/
  web/                 Next.js: interface for landlords, later portals
  api/                 NestJS: modular monolith
    src/modules/       one folder per domain module, see below
  worker/              background jobs (bank sync, OCR, PDF, delivery)
packages/
  settlement-engine/   pure settlement logic
    src/rules/de/      versioned rule sets per settlement period
    fixtures/          reviewed settlement cases as test data
  db/                  SQL migrations, tenant isolation, ledger posting
  integrations/        adapters to external services (banking, ocr, email, payments)
  contracts/           API schemas and shared types            (not created yet)
  pdf-templates/       HTML templates for settlements, letters (not created yet)
  ui/                  shared interface components             (not created yet)
docs/
  adr/                 architecture decisions, one file per decision
  domain-rules/        rules and sources for BetrKV, HeizkostenV, CO2KostAufG
  STRUCTURE.md         this document
infra/
  compose.yaml         local database
  scripts/             check and operations scripts
tests/e2e/             end-to-end tests through the interface
.github/workflows/     CI
```

## Allowed API modules

`health`, `organization`, `property`, `tenancy`, `metering`, `finance`, `banking`,
`documents`, `settlement`, `deadlines`, `tax`, `subscription`

Every module has an `index.ts`. It is the only file other modules and the rest
of the API may import.

## Boundaries

| Rule | Meaning |
| --- | --- |
| Engine is pure | `settlement-engine` imports nothing outside its own package: no database, no network, no Node modules. Input data in, result out. |
| Packages do not know apps | Code under `packages/` never imports from `apps/`. |
| Apps do not know each other | `web`, `api` and `worker` share code only through `packages/`. |
| Modules only via index | An API module never reaches into the internals of another. |
| No cycles | Circular imports are forbidden. |

## Rules for data

- Every domain table carries `tenant_id` and an RLS policy, enabled and forced.
  A test fails if a table lacks it. References between tables use composite
  foreign keys `(tenant_id, id)`.
- Money is an integer in cents (`bigint`), never a floating-point number.
- Whatever changes and is settled is versioned in time (date range; the
  database prevents overlaps).
- The ledger is immutable. Journal entries and lines cannot be updated or
  deleted; a correction is a reversing entry. Every entry balances to zero.
- Migrations are SQL files in `packages/db/migrations/`. Once a migration has
  run on a shared environment it is never changed; corrections are new files.
