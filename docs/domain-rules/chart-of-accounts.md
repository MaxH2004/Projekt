# Chart of accounts

## Which standard

There is no chart of accounts prescribed by law in Germany. De-facto standards:

| Chart | Publisher | Fits |
| --- | --- | --- |
| SKR 03 / SKR 04 | DATEV | General standard charts; what tax advisers expect in a DATEV export. |
| SKR 03 / SKR 04 "Vermietung und Verpachtung" | DATEV (item no. 12911 / 12912) | Variant for the income statement under § 21 EStG, with six-digit accounts. The fit for private landlords. |
| Kontenrahmen der Wohnungswirtschaft | GdW | Housing companies; revised for the balance sheet layout mandatory from 2026-01-01. |
| Kontenrahmen Wohnungsunternehmen (based on SKR 03) | DATEV (item no. 12305) | Housing companies using DATEV. |

Decision: the ledger uses the account numbers of **DATEV SKR 04 Vermietung
und Verpachtung**, so a later DATEV export needs no mapping.

## Source

DATEV-Kontenrahmen für Überschussermittlung nach § 21 EStG,
Standardkontenrahmen SKR 04, valid for 2026, item no. 12912, dated 2026-01-01.
Provided by the product owner on 2026-11-16. The document is not in the
repository.

## What the chart tells us

- Accounts have six digits: the four-digit SKR 04 account and a two-digit
  sub-account. `00` is the standard account.
- The chart is built for the cash-based income statement under § 21 EStG.
  Each account is mapped to a line of that statement, for example "rent for
  apartments (without allocated costs)", "allocated costs", "maintenance",
  "loan interest", "depreciation", "other income-related expenses". This
  mapping is the basis for the Anlage V export.
- Cost accounts come in a fixed pattern for mixed-use properties: `00` fully
  deductible, `20–29` deductible share, `30` not deductible, `40–49`
  deductible share with 19 % input tax. Stage 1 only uses the `00` accounts.
- Costs that DATEV marks as "allocated costs" (caretaker, heating, water,
  insurance, waste, property tax and others) are the ones a landlord normally
  passes on to tenants. Whether a cost may be passed on is decided by BetrKV
  and the rental contract, not by this mark.

## Open before go-live

1. **Licence.** The document states that reprinting, also in excerpts, is not
   permitted. `packages/db/src/charts/skr04.ts` therefore contains account
   numbers with our own descriptions, not the publisher's wording. Whether
   shipping DATEV account numbers and showing DATEV's account names inside
   the product needs a licence must be clarified with DATEV.
2. **Annual update.** DATEV publishes a new edition every year and marks new,
   renamed and deleted accounts. The chart needs a yearly check.
3. **Review** of the posting rules (which business event uses which account)
   by a tax adviser.
4. **Mixed use and VAT.** Accounts for partly deductible costs and for letting
   subject to VAT are not included yet.
