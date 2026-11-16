# 0001 – Stack and structure

Date: 2026-11-16

## Decision

- Modular monolith in TypeScript as a pnpm workspace, structured as in `docs/STRUCTURE.md`.
- Backend NestJS, frontend Next.js, database PostgreSQL 16.
- Tenant isolation through row-level security; the tenant is set per transaction.
- Migrations as plain SQL files, because RLS policies and exclusion constraints
  are written in SQL anyway.
- Settlement engine as a pure package without dependencies.
- Double-entry ledger from the start, immutable at database level.
- Bank data behind an adapter port. PSD2 is prepared as a provider but not connected.
- Hosting: first a test server with Docker, later STACKIT.
- Everything in the repository is written in English.

## Open

- Query layer in the API (Drizzle or Kysely on top of the SQL schema).
- Auth library with 2FA.
- Job queue (proposal: pg-boss).
- How organizations are created when the database offers no superuser
  (common with managed databases).
- Chart of accounts for the ledger.
- OCR provider with processing in the EU.
- Language of the product interface for end users (German market) versus the
  English-only repository: needs i18n once the interface is built.
