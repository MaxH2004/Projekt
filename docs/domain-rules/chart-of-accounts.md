# Chart of accounts

## Which standard

There is no chart of accounts prescribed by law in Germany. De-facto standards:

| Chart | Publisher | Fits |
| --- | --- | --- |
| SKR 03 / SKR 04 | DATEV | General standard charts; what tax advisers expect in a DATEV export. |
| SKR 03 / SKR 04 "Vermietung und Verpachtung" | DATEV (item no. 12911 / 12912) | Variant for rental income with six-digit accounts. The closest fit for private landlords. |
| Kontenrahmen der Wohnungswirtschaft | GdW | Housing companies; revised for the balance sheet layout mandatory from 2026-01-01. Aimed at large housing companies. |
| Kontenrahmen Wohnungsunternehmen (based on SKR 03) | DATEV (item no. 12305) | Housing companies using DATEV. |

Decision: the ledger uses **SKR 04** account numbers, so a later DATEV export
needs no mapping.

## Status: partial and not yet reviewed

`packages/db/src/charts/skr04.ts` holds only accounts whose number and name
were confirmed by at least one public source (below). It is not complete for
stage 1. Missing in particular: advance payments for operating costs,
insurance, depreciation, interest, equity and private accounts.

Before go-live:

1. Obtain the current DATEV chart "SKR 04 Vermietung und Verpachtung"
   (item no. 12912) and check every account against it. That variant uses
   six-digit numbers; decide whether to adopt them.
2. Have a tax adviser confirm the mapping of the product's postings.
3. Clarify with DATEV whether shipping the chart inside the product needs a
   licence.

## Sources (retrieved 2026-11-16)

Only search-result excerpts could be read; the original documents were not
reachable from the development environment.

- DATEV shop, SKR 04 Vermietung und Verpachtung: https://www.datev.de/web/de/shop/produkt-details/skr-04-vermietung-und-verpachtung-12912
- DATEV shop, Kontenrahmen Wohnungsunternehmen: https://www.datev.de/web/de/shop/produkt-details/kontenrahmen-wohnungsunternehmen-basis-skr-03-12305
- SKR 04 account list (1200, 3300): https://www.collmex.de/skr04.pdf
- 1350 Kautionen, 3550 Erhaltene Kautionen: https://www.steuerschroeder.de/Kontenrahmen-SKR04-Bilanzgliederungsprinzip.html
- 1600 Kasse, 1800 Bank, 4105 tax-exempt rental revenue: https://datenbank.nwb.de/Dokument/742089/
- 6325, 6335: https://www.steuertipps.de/downloads/article/s-255194/1/cs_standardkontenrahmen_skr04.pdf
- 6340, 6350: https://datenbank.nwb.de/Dokument/708954/ and https://www.buchungssatz.de/de_DE/konto/skr04/6350.html
- GdW chart and its 2026 revision: https://www.haufe.de/id/beitrag/vorwort-zur-10-auflage-des-kommentars-zum-kontenrahmen-der-wohnungswirtschaft-HI10898180.html
