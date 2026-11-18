# Rent charges, payments and open items

Status: **not reviewed.** Built on 2026-11-18 without a tax adviser or lawyer.
The points under "Open questions" need one before go-live. The statutes named
there are cited from memory and were not read in the original; none of them is
implemented.

## What the software does

| Step | Rule | Where |
| --- | --- | --- |
| Charge | For every month, each rent component valid in that month becomes one charge per tenancy (`base_rent`, `operating_cost_advance`, `heating_cost_advance`). Running a month again only adds what is missing. | `apps/api/src/modules/finance/monthly-charges.ts`, table `rent_charge` |
| Proration | A component that applies for only part of a month (move-in, move-out, change of amount) is charged for the days it applies over the days of the calendar month. Rounding goes through `allocate`. | same |
| Due date | The first day of the month, or the first day of the tenancy if it starts later. | same |
| Payment | Recorded against one tenancy. The caller may say which charges it covers; otherwise it covers the oldest open charges first, within a due date in the order base rent, operating cost advance, heating cost advance. | `finance.service.ts`, tables `payment`, `payment_allocation` |
| Overpayment | What a payment does not cover stays as credit of the tenancy. | same |
| Reversal | A payment can be reversed once. The reversing journal entry mirrors the original; the charges it covered are open again. | same |
| Cancellation | A charge that is not owed can be cancelled while no payment in force covers it. A cancelled charge is not created again for the same month. | same |

## Bank statements

| Step | Rule | Where |
| --- | --- | --- |
| Import | A camt.053 file (versions 001.02 to 001.08) is read; booked entries in euro are stored per bank account, pending and foreign currency entries are skipped. The account is created on first import. Importing posts nothing. | `packages/integrations/src/banking/camt.ts`, `apps/api/src/modules/banking/` |
| Duplicates | An entry is identified by the bank's reference (`AcctSvcrRef`) if it is unique in the statement, otherwise by its content and its position among identical entries. Importing an overlapping statement adds only new entries. | same |
| Suggestions | For an open incoming transaction the tenancies are ranked: IBAN booked to the tenancy before (4 points), amount equal to the open amount of a month, all open charges or the monthly rent (2), names of the tenants in payer or remittance text (1). Up to three tenancies are shown; nothing is booked without the user. | `apps/api/src/modules/banking/matching.ts` |
| Booking | Booking an incoming transaction records a payment with its amount and booking date (see above); the database refuses a payment that differs from its transaction. Reversing the payment opens the transaction again. | `banking.service.ts`, `0007_bank_import.sql` |
| Ignoring | A transaction that needs no booking here (private, outgoing) can be marked as ignored and unmarked again, unless it is booked. | same |

## Posting rules

The income statement under § 21 EStG is cash based, see
`chart-of-accounts.md`. Charges therefore post nothing; a payment posts when it
arrives, dated with the day it was received.

| Event | Debit | Credit |
| --- | --- | --- |
| Payment covering base rent | 180000 Bank | 410500 Rent for apartments |
| Payment covering an operating or heating cost advance | 180000 Bank | 410800 Advance payments for operating costs |
| Part of a payment not covering a charge | 180000 Bank | 350000 Other liabilities (tenant credit) |
| Reversal of a payment | the original lines with opposite signs | |

Every line carries the property as cost centre. The accounts are in
`apps/api/src/modules/finance/posting-rules.ts`.

## Open questions

1. **Tax adviser:** whether an overpayment belongs on 350000 or is income when
   received; regularly recurring payments around the turn of the year
   (§ 11 (1) sentence 2 EStG) are not treated specially; units are all treated
   as apartments (410500), garages and commercial rooms would need 410690 and
   410600.
2. **Lawyer:** the order in which a payment covers debts when the tenant does
   not say (§ 366 BGB) is simplified to "oldest first". The statutory due date
   of rent (§ 556b (1) BGB: third working day) is not used; the due date is the
   first day of the month. Proration by calendar days may differ from what a
   contract agrees.
