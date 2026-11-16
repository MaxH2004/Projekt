# Property management

Software for rental property management, first for private landlords in Germany.

## Binding

- Everything in the repository is in English: code, comments, messages, docs,
  commit messages.
- The folder structure and module boundaries are in `docs/STRUCTURE.md`. No new
  folders on the levels listed there without an entry in `docs/adr/`.
- `pnpm verify` must be green before every commit.
- Never implement legal calculation rules (BetrKV, HeizkostenV, CO2KostAufG)
  from memory: only with a source in `docs/domain-rules/` and a test case in
  `packages/settlement-engine/fixtures/`.
- No real renter or bank data and no credentials in the repository.

## Commands

- `pnpm install`
- `pnpm verify` – structure, build, types, boundaries, tests
- `pnpm db:migrate` – needs `DATABASE_URL`
- Tests in `packages/db` and `apps/api` need `TEST_DATABASE_URL`; the database name must end in
  `_test` because the tests reset the schema. Local database:
  `docker compose -f infra/compose.yaml up -d`

## Conventions

- `tenant` means the software's customer (table `organization`), a `tenancy` is
  a rental contract, and the people renting are `person` rows linked to it.
- Money as `bigint` in cents. Splits only through `allocate` from the engine.
- Ledger postings only through `postJournalEntry` / `reverseJournalEntry` from
  `@hv/db`.
- API errors are codes from `@hv/contracts` (`ApiError`), never sentences.
- No user-visible text in code; see "Languages" in `docs/STRUCTURE.md`.
