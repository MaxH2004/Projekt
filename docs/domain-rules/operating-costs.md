# Operating cost settlement

Status: **not reviewed.** The product owner decided on 2026-11-16 to start
without reviewed cases. The rules below were taken from the statutes as
summarised in the sources at the end; the original statute texts could not be
opened from the development environment. The test cases in
`packages/settlement-engine/fixtures/` are invented and calculated by hand.
Every fixture carries `"reviewed": false` until a property manager or lawyer
has checked it.

## Rules implemented

| Rule | Basis | In the engine |
| --- | --- | --- |
| The landlord settles advance payments once a year; a settlement period is at most twelve months. | § 556 (3) BGB | A longer period is rejected. |
| The statement must reach the tenant by the end of the twelfth month after the period ends. After that the landlord can no longer claim a balance. | § 556 (3) BGB | The result carries this date as `deadline`. Sending and tracking are up to the application. |
| Without a different agreement costs are spread by floor area. Costs that depend on recorded consumption are spread by consumption. | § 556a (1) BGB | The key is chosen per cost: area, units, persons, consumption, direct. The engine does not choose a default; the application has to. |
| Only the cost types listed in § 2 nos. 1 to 17 BetrKV may be passed on, and only if the contract says so. | § 556 (1) BGB, § 2 BetrKV | Every cost carries one of the 17 categories. Whether a single invoice may be passed on is decided before the engine is called. |
| Shares for vacant units and vacant days stay with the landlord. | case law, see sources | Vacant days get their share like a tenancy; it is reported under `landlord`. |
| When a tenant changes, costs are divided to the day. | common practice | Unit share times days of the tenancy over days of the period. |
| Heating and hot water are settled under HeizkostenV. | HeizkostenV | Not implemented. These categories are only accepted per unit (`direct`), i.e. taken over from a metering company's statement. |

Rounding: amounts are split to the cent by the largest-remainder method, so
the shares of a cost always add up to exactly its total.

## Simplifications and open questions

1. **Persons key and vacancy.** Whether and with how many persons a vacant
   unit counts is not settled by statute. The engine has no default; the
   caller passes `vacancyPersons`. Needs a decision by a lawyer.
2. **Consumption on tenant change.** Consumption is given per unit and
   divided by days between the tenancies of that unit. With an interim meter
   reading at move-out the real consumption per tenancy should be used
   instead. Not built yet.
3. **Changes during the period.** Area and number of persons are taken as
   constant for the whole period. A change mid-period is not handled.
4. **Cable television.** Fees for older broadband distribution systems could
   only be passed on until 2024-06-30; since then no. 15 is limited to
   operating electricity and, for fibre, the provision fee. The engine does
   not check this; the application must not offer the cost type for later
   periods.
5. **Cost-efficiency and formal requirements** of a statement (total cost,
   key, share, advances shown for each cost) concern the document, not the
   calculation, and belong to the statement template.
6. **Suggested advance.** The share projected to twelve months divided by
   twelve is a convenience. Raising advances has its own rules (§ 560 BGB),
   which are not implemented.

## Sources (retrieved 2026-11-16)

- BetrKV § 2, official text: https://www.gesetze-im-internet.de/betrkv/__2.html
- § 556 (3) BGB, yearly settlement and twelve-month deadline: https://datenbank.nwb.de/Dokument/688723/
- Vacancy borne by the landlord, total area as the basis: https://www.mietrechtsiegen.de/nebenkosten-bei-leerstand-wer-zahlt/
- Persons key and its explanation in the statement: https://www.haufe.de/id/kommentar/betriebskostenumlage-erlaeuterung-des-umlagemassstabs-bei-personenschluessel-HI2612794.html
- Agreed floor area and deviations (BGH VIII ZR 261/06): https://rewis.io/urteile/urteil/coa-30-10-2007-viii-zr-26106/
- Cable fees no longer allocable from 2024-07-01: https://www.goerg.de/de/aktuelles/veroeffentlichungen/05-03-2024/betriebskostenabrechnung-antennen-beziehungsweise-kabel-tv-gebuehren-fuer-altanlagen-ab-dem-1-juli-2024-nicht-mehr-umlagefaehig
- No. 15 BetrKV after the telecommunications reform: https://deutschesmietrecht.de/betriebskosten/betriebskostenarten/785-nr-15-betrkv-gemeinschaftsantenne-breitbandnetz-glasfaserbereitstellungsentgelt.html
