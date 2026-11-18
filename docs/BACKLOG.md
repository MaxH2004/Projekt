# Open scope

Everything that belongs to stage 1 and is not finished, everything that was
deliberately skipped or simplified, and everything waiting for a decision.
Stage 1 is defined by the product plan: private landlords with 1–20 units.

**Rule:** whoever skips, defers or simplifies something records it here in the
same commit. An item is removed only when it is done and verified.

Last full review: 2026-11-18.

## 1. Stage 1 features

| Area | Done | Open |
| --- | --- | --- |
| Master data | API and interface for properties, buildings, units, persons and tenancies with rent changes and end; API for area history, meters and readings | Interface for area history, meters and readings, editing persons and buildings · deposit (amount, where it is held, interest) · logic for graduated and indexed rent (only the type is stored) · number of persons per tenancy over time · rooms per unit · co-ownership shares · owner as an entity · meter replacement |
| Finance | Ledger with immutable balanced entries and reversal · chart of accounts · API for monthly rent charges, payments with allocation to charges, reversal, open items and balance per tenancy, with posting rules for rent payments · bank statement import (camt.053) with suggested tenancies and booking as payment · expenses split over accounts and properties with BetrKV category, from the bank or private money, booking outgoing transactions · income and expenses per property · tenant credit applied to later charges and paid back · settlement credits paid out · other bank bookings to any account (deposit, refund, private transfer) · interface for all of it, with expenses split over lines and payments assigned to chosen charges | Bank statement import from CSV · loan repayments split into interest and principal (no loan accounts in the chart yet) · payment reminder by e-mail |
| Receipts | Port for document extraction · file storage (local disk) · receipts uploaded in the web interface, attached to an expense when recording it or later, downloadable, never deletable | Upload by app or e-mail forwarding · receipts without an expense yet (inbox) · extraction with user confirmation · invoice tables |
| Settlements | Engine core for operating costs with three hand-calculated cases · settlement per property from expenses, tenancies and paid advances, with preview, final storage with rule set, balance charges, credits paid out, cancellation, interface and statement as a printable page | Heating cost settlement (HeizkostenV) · CO2 cost split (CO2KostAufG) · consumption key from meter readings · statement as a real PDF file (printed from the browser now) · sending · the simplifications in section 3 |
| Documents and deadlines | Documents per property and tenancy (contract, correspondence, other) with upload, download and deletion · template system with payment reminder and operating cost statement in three languages · payment reminder for the overdue items of a tenancy as a printable page · sender and bank details of the organization on letters | Templates for rental contract, rent increase, index adjustment, handover record (need a lawyer) · reminders for index adjustment, graduated steps, contract end, maintenance, smoke detectors |
| Tax | Chart of accounts maps to the lines of the § 21 EStG statement | Anlage V export · separate reporting under § 35a EStG |
| Account and subscription | Registration, login, sessions, two-factor authentication with recovery codes, login lock, password and e-mail change, with interface · port for subscription billing | QR code for setting up two-factor authentication · See section 2 · plans and prices · data export · deleting an account and its data |

## 2. Account and security

Done: audit log of every change to financial data with user and time,
append-only in the database and shown on the account page; password and e-mail change with the current password (a password change
ends the other sessions), recovery codes for two-factor authentication and
switching it off, rate limits per client address on login, registration and
every password check, security headers on API and interface, no CORS, expired
sessions deleted at login and by `deleteExpiredSessions`.

- No e-mail verification on registration or e-mail change, and no password
  reset: all three need outgoing e-mail (provider, see section 5).
- Registration reveals whether an e-mail address is already registered; fixing
  it needs the verification mail.
- The login lock (5 failures, 15 minutes) still lets a third party lock an
  account; the rate limit only slows this down.
- Rate limits are counted in memory per API process; several processes or a
  restart reset them. The client address comes from `X-Forwarded-For` only
  when `TRUST_PROXY` is set, which the deployment must do (the web app
  forwards the header it receives).
- The interface's Content-Security-Policy does not restrict scripts; Next.js
  inlines scripts and would need a nonce per request.
- CSRF protection: `SameSite=Lax` cookies plus the origin check of Next.js
  server actions; the API itself has no CSRF token.
- The audit log covers the financial tables and the organization's bank
  details, not master data such as properties, units and persons. It keeps
  every entry forever; retention and export are not decided.
- No penetration test and no secret scanning. CI audits dependencies:
  production dependencies fail the build; development tools are only reported
  (one open: picomatch in dependency-cruiser, no fix released yet).

## 3. Simplifications in what exists

Settlement engine, details in `docs/domain-rules/operating-costs.md`:

- Statute texts were not read in the original; rules come from summaries.
- Persons key: how a vacant unit counts must be passed in; no legal default.
- Consumption is divided by days on tenant change, not by interim reading.
- Area and number of persons are constant for the whole period.
- Cable fees after 2024-06-30 are not blocked by the engine.
- Raising advance payments (§ 560 BGB) is only a suggestion value.
- Heating and hot water are only accepted as finished amounts per unit.

Settlement in the application, details in `docs/domain-rules/operating-costs.md`:

- Costs count by payment date; expenses have no service period.
- Heating and hot water costs and advances are left out of the settlement.
- A property is one settlement unit; costs cannot be split between buildings.
- Persons per tenancy are entered for each settlement, not stored over time.
- An area that changes within the period blocks the area key.
- A final settlement can be cancelled and made again while nothing was paid
  on it; there is no correction statement that shows the difference.

Payment reminders:

- Reminders are not recorded: there is no history of which items were
  reminded when, and no dunning levels or fees.
- "Overdue" means due before today; the third working day of § 556b BGB is
  not applied (see rent charges).
- The suggested payment date of two weeks is a convention, not a legal rule.
- Letters are printable pages; no PDF file, no sending by e-mail or post.
- The organization's name cannot be changed, and only one bank account can be
  printed on letters.
- The statement letter has not been checked by a lawyer.

Rent charges and payments, details in `docs/domain-rules/rent-and-payments.md`:

- Posting rules and the open questions there are not reviewed by a tax adviser
  or lawyer.
- A payment without explicit allocation covers the oldest charges first; § 366
  BGB is not modelled.
- Due date is the first day of the month, not the third working day.
- Every unit books base rent to the apartment account; units have no type of
  use (apartment, garage, commercial).
- Charges are not corrected when the rent is changed retroactively after they
  were created; a cancelled charge is never created again for the same month,
  and there is no manual charge for a single month.
- Tenant credit is applied only on request ("apply credit"), oldest charges
  first; it is not applied automatically when new charges are created.
- Allocations of a payment are fixed when it is recorded; reallocating means
  reversing it. A payment whose credit was paid back cannot be reversed until
  the refund is reversed.
- Credit and settlement refunds are booked from the bank (180000) only, not
  in cash.
- Expense accounts are chosen by the user; there is no suggestion from vendor,
  text or BetrKV category, and no check that category and account fit.
- An expense has no service period; the settlement will have to decide
  whether costs count by payment date or by the period they cover.
- Other bank bookings take one account per transaction; splitting a
  transaction over several accounts is not possible. A deposit booked to
  355000 is not linked to the tenancy (no deposit record yet).
- The income statement is by booking date over all accounts and does not
  apply the tax rules for Anlage V (e.g. depreciation, § 11 EStG).
- Only one bank account (180000) in the ledger, although several bank
  accounts can be imported.

Bank import:

- The camt.053 reader was written against the published structure and
  invented files, not against statements of real banks. Needs anonymised
  sample files from several banks (Sparkasse, Volksbank, a direct bank).
- Batch bookings (several transaction details in one entry) are not split;
  the first detail names the counterparty.
- No CSV import; banks' CSV layouts differ and need a column mapping.
- The ledger's bank balance differs from the real one as long as
  transactions stay unbooked or ignored; there is no reconciliation view.
- Suggestion weights are a first guess and not measured on real data.
- The JSON body limit of the API is raised to 3 MB for all routes because the
  statement travels as a JSON string; a separate upload route would allow a
  smaller limit elsewhere.

Master data:

- Rent components can be dated after the end of a tenancy; nothing trims them.
  Charges ignore the days after the end.
- A tenancy and its rent history cannot be corrected or deleted through the
  API, only ended.
- Meter readings are not checked for plausibility (a lower reading than the
  previous one is accepted).

Ledger and chart of accounts, details in `docs/domain-rules/chart-of-accounts.md`:

- Only fully deductible accounts; none for mixed use or letting with VAT.
- Existing organizations do not get new accounts automatically when the chart
  grows.
- No fiscal years, no period closing, no opening balances.

## 4. Languages

- French and Spanish texts were written by the developer and not reviewed by
  native speakers.
- The user's stored language is not yet used for documents, e-mails or the
  interface; the interface follows its language cookie or the browser.
- Account names of the chart are translated in the interface catalogs; the
  names stored in the database are English. A test that every chart account
  has a translation is missing.
- Date inputs use the browser's date picker, whose format follows the browser
  language, not the chosen interface language.
- Statutory documents (statements, rent increases) are only meaningful in
  German law; whether they are offered in other languages is undecided.

## 5. Integrations

All four are ports with a placeholder that rejects every call, plus a fake for
tests. Nothing is connected.

| Integration | Suggested provider | Waiting for |
| --- | --- | --- |
| Bank data (PSD2) | finAPI or Tink | Decision and contract. File import (camt.053) exists. |
| E-mail, outgoing and incoming | Brevo; alternatives Mailjet, Postmark | Decision, sender domain with SPF/DKIM |
| Document extraction | Mistral; alternatives Azure Document Intelligence, Mindee | Decision, data processing agreement |
| Subscription billing | Stripe; alternatives Mollie, Paddle | Decision, plans and prices |

## 6. Platform and operations

- Interface: plain server-rendered pages without a component library;
  `packages/ui` does not exist yet. Forms need JavaScript (no fallback
  without it).
- The interface reaches the API server side only (`API_URL`); in production
  both must run behind one HTTPS origin, which is not set up.
- The worker runs periodic jobs (current month's rent charges, expired
  sessions) every hour; there is no queue for event-driven jobs such as
  sending e-mails or rendering PDFs. Charges are created automatically for the
  current month for every organization; there is no setting to switch that
  off.
- File storage is a local directory; the S3-compatible store is a placeholder.
  No virus scan of uploads (only PDF, JPEG, PNG and WebP are accepted, by
  their content). No PDF rendering.
- The end-to-end tests run in CI as a separate job, not in `pnpm verify`;
  Playwright is installed there globally, not as a dependency of the
  repository.
- No OpenAPI description of the API, although ADR 0001 planned one.
- Container images exist, but API, worker and migration images carry the
  development dependencies (about 1.4 GB); the web image is small.
- No deployment and no test server yet; STACKIT later. See docs/OPERATIONS.md.
- Unit and API tests still run as superuser; the end-to-end job runs as
  `hv_login`.
- Backups are a script; scheduling them and storing them off the machine
  belong to the server setup. No monitoring, no error tracking.
- TypeScript is pinned to 5.9; version 7 was not tried.

## 7. Deviations from earlier decisions

Recorded in `docs/adr/0002-identity-and-data-access.md`:

- Plain SQL instead of Drizzle.
- Authentication built on Node's crypto functions instead of a library.

## 8. Waiting for the product owner or third parties

- Reviewed settlement cases from a property manager or lawyer (20–30 planned).
- Lawyer: persons key and vacancy, contract templates, terms and conditions,
  liability, whether the product counts as legal advice.
- Tax adviser: posting rules, Anlage V mapping, § 35a.
- DATEV: licence for account numbers and names inside the product; yearly
  update of the chart.
- Providers for the four integrations.
- Test server: provider, domain, deploy access.
- Data protection: processing agreements, privacy notice, record of
  processing activities, deletion concept, hosting in the EU.
- Company form and liability insurance.

## 9. Not in stage 1 on purpose

From the product plan: tenant portal, several users per organization,
condominium (WEG) management, full professional accounting, native mobile
app. The data model keeps room for them; nothing is built.
