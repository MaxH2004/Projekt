# 0002 – Identity, data access and chart of accounts

Date: 2026-11-16

## Decisions

- **New API module `identity`** for registration, login, sessions and
  two-factor authentication. It is added to the allowed modules.
- **Two database roles.** `hv_app` sees tenant data of one tenant per
  transaction. `hv_auth` sees users, memberships and sessions and may create
  organizations, but cannot read tenant data. The login user of an environment
  is a member of both and switches per transaction. This also answers the open
  point from ADR 0001: creating an organization needs no superuser.
- **Plain SQL through `pg`** instead of a query builder. ADR 0001 proposed
  Drizzle or Kysely; the schema relies on RLS, exclusion constraints and
  triggers, which are written in SQL anyway, and a second schema definition
  would have to be kept in step with the migrations. Revisit if query code
  becomes repetitive.
- **Authentication built on Node's crypto primitives** instead of an auth
  library: scrypt password hashes, opaque session tokens stored as SHA-256,
  TOTP per RFC 6238 (checked against the RFC test vectors), TOTP secrets
  encrypted with AES-256-GCM. Reason: the tenant and role model is specific to
  this product, and the pieces are small and fully tested. Revisit with SSO in
  stage 4.
- **Chart of accounts: SKR 04**, see `docs/domain-rules/chart-of-accounts.md`.
- **Tests run one package at a time** because they share one test database.

## Known gaps

- No e-mail verification and no password reset yet; both need the e-mail
  integration.
- Registration reveals whether an e-mail address is already registered.
- The login lock (5 failures, 15 minutes) lets a third party lock an account
  by guessing. There is no rate limit per IP address yet.
- Sessions are bound to one organization; switching organizations comes with
  stage 2.
- Disabling two-factor authentication and recovery codes are not built yet.
