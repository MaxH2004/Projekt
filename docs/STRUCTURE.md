# Folder structure

This structure is binding. `pnpm lint:structure` and `pnpm lint:boundaries`
check it on every CI run. A new folder on any of the levels listed below needs
a decision in `docs/adr/` and an entry in `infra/scripts/check-structure.mjs`.

```
apps/
  web/                 Next.js: interface for landlords, later portals
    messages/          interface texts, one JSON file per locale
  api/                 NestJS: modular monolith
    src/modules/       one folder per domain module, see below
    src/common/        configuration, database pool, error format
  worker/              background jobs (bank sync, OCR, PDF, delivery)
packages/
  settlement-engine/   pure settlement logic
    src/rules/de/      versioned rule sets per settlement period
    fixtures/          reviewed settlement cases as test data
  db/                  SQL migrations, tenant isolation, ledger posting
  integrations/        ports to external services: banking, email,
                       document-extraction, subscription-billing
  contracts/           shared types and API schemas, supported locales
  pdf-templates/       localized HTML templates for letters and settlements
  ui/                  shared interface components (not created yet)
docs/
  adr/                 architecture decisions, one file per decision
  domain-rules/        rules and sources for BetrKV, HeizkostenV, CO2KostAufG
  STRUCTURE.md         this document
  BACKLOG.md           everything open, skipped or simplified
infra/
  compose.yaml         local database
  scripts/             check and operations scripts
tests/e2e/             end-to-end tests through the interface
.github/workflows/     CI
```

## Allowed API modules

`health`, `identity`, `organization`, `property`, `tenancy`, `metering`, `finance`, `banking`,
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
  A test fails if a table lacks it. The API reaches tenant data only through
  `withTenant` (role `hv_app`).
- Users, memberships and sessions are not tenant data. They are reachable only
  through `withIdentity` (role `hv_auth`), which in turn cannot read tenant data. References between tables use composite
  foreign keys `(tenant_id, id)`.
- Money is an integer in cents (`bigint`), never a floating-point number.
- Whatever changes and is settled is versioned in time (date range; the
  database prevents overlaps).
- The ledger is immutable. Journal entries and lines cannot be updated or
  deleted; a correction is a reversing entry. Every entry balances to zero.
- Migrations are SQL files in `packages/db/migrations/`. Once a migration has
  run on a shared environment it is never changed; corrections are new files.

## Languages

- Supported locales are defined once, in `packages/contracts/src/locale.ts`.
- No user-visible text in code. Interface texts live in `apps/web/messages/`,
  document texts in `packages/pdf-templates/src/locales/`. German is the
  reference catalog; tests fail when another locale misses a key or placeholder.
- The API returns error codes, not sentences; the interface translates them.
- Amounts and dates are formatted with the locale, never by hand.
