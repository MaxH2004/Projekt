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
| Finance | Ledger with immutable balanced entries and reversal · chart of accounts · API for monthly rent charges, payments with allocation to charges, reversal, open items and balance per tenancy, with posting rules for rent payments · bank statement import (camt.053) with suggested tenancies and booking as payment · expenses split over accounts and properties with BetrKV category, from the bank or private money, booking outgoing transactions · income and expenses per property · interface for all of it | Bank statement import from CSV · incoming transactions other than rent (refunds, deposits, loans) · loan repayments with interest and principal · applying tenant credit to later charges · refunding credit · payment reminder by e-mail · generating charges automatically each month (worker job) · interface: allocating a payment to chosen charges, splitting an expense over several lines or properties, confirmation before cancelling |
| Receipts | Port for document extraction | Upload (web, app, e-mail forwarding) · file storage · extraction with user confirmation · assignment to property, cost type and allocability · invoice tables |
| Settlements | Engine core for operating costs with three hand-calculated cases · settlement per property from expenses, tenancies and paid advances, with preview, final storage with rule set, balance charges, interface and statement as a printable page | Heating cost settlement (HeizkostenV) · CO2 cost split (CO2KostAufG) · consumption key from meter readings · correcting a final settlement · paying out refunds · statement as a real PDF file (printed from the browser now) · sending · the simplifications in section 3 |
| Documents and deadlines | Template system with payment reminder in three languages | Document storage per property and tenancy · templates for rental contract, rent increase, index adjustment, handover record (need a lawyer) · reminders for index adjustment, graduated steps, contract end, maintenance, smoke detectors |
| Tax | Chart of accounts maps to the lines of the § 21 EStG statement | Anlage V export · separate reporting under § 35a EStG |
| Account and subscription | Registration, login, sessions, two-factor authentication, login lock, with interface · port for subscription billing | QR code for setting up two-factor authentication · See section 2 · plans and prices · data export · deleting an account and its data |

## 2. Account and security

- No e-mail verification on registration.
- No password reset, no password or e-mail change.
- No recovery codes for two-factor authentication and no way to switch it off.
  A user who loses the authenticator is locked out.
- Registration reveals whether an e-mail address is already registered.
- The login lock (5 failures, 15 minutes) lets a third party lock an account.
  No rate limit per IP address on any route.
- CSRF protection relies on `SameSite=Lax` alone. No security headers, no CORS
  configuration.
- No audit log. The plan requires one for changes to financial data from
  stage 1.
- Sessions are never cleaned up after they expire.
- No penetration test, no dependency or secret scanning in CI.

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
- Refunds are shown on the statement but not booked or paid out.
- A final settlement cannot be corrected or replaced.
- The statement has no IBAN of the landlord; organizations have no bank
  details yet.
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
- Tenant credit cannot be applied to later charges or paid back; the payment
  has to be reversed and recorded again.
- Allocations of a payment are fixed when it is recorded; reallocating means
  reversing it.
- Expense accounts are chosen by the user; there is no suggestion from vendor,
  text or BetrKV category, and no check that category and account fit.
- An expense has no service period; the settlement will have to decide
  whether costs count by payment date or by the period they cover.
- Expenses cannot carry a receipt yet.
- Incoming money that is not rent (insurance refund, deposit) cannot be
  booked, only ignored.
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
- Worker has no jobs and no queue.
- No file storage (S3-compatible) and no PDF rendering.
- `tests/e2e/main-flow.mjs` covers the main flow but runs by hand against
  running servers; not in `pnpm verify` or CI, and Playwright is not a
  dependency of the repository.
- No OpenAPI description of the API, although ADR 0001 planned one.
- `/health` does not check the database.
- No container images, no deployment, no test server. STACKIT later.
- No script that creates the database login user as a member of `hv_app` and
  `hv_auth`; tests run as superuser.
- No backups, no restore test, no monitoring, no error tracking.
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
