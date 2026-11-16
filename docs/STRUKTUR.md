# Ordnerstruktur

Diese Struktur ist verbindlich. `pnpm lint:structure` und `pnpm lint:boundaries`
prüfen sie bei jedem CI-Lauf. Ein neuer Ordner auf einer der unten genannten
Ebenen braucht eine Entscheidung in `docs/adr/` und einen Eintrag in
`infra/scripts/check-structure.mjs`.

```
apps/
  web/                 Next.js: Oberfläche für Vermieter, später Portale
  api/                 NestJS: modularer Monolith
    src/modules/       ein Ordner je Fachmodul, siehe unten
  worker/              Hintergrundjobs (Bankabruf, OCR, PDF, Versand)
packages/
  settlement-engine/   reine Abrechnungslogik
    src/rules/de/      versionierte Regelsätze je Abrechnungszeitraum
    fixtures/          geprüfte Abrechnungsfälle als Testdaten
  db/                  SQL-Migrationen, Mandantentrennung
  integrations/        Adapter zu externen Diensten (banking, ocr, email, payments)
  contracts/           API-Schemas und gemeinsame Typen      (noch nicht angelegt)
  pdf-templates/       HTML-Vorlagen für Abrechnungen, Briefe (noch nicht angelegt)
  ui/                  gemeinsame Oberflächenkomponenten      (noch nicht angelegt)
docs/
  adr/                 Architekturentscheidungen, eine Datei je Entscheidung
  fachlogik/           Regeln und Quellen zu BetrKV, HeizkostenV, CO2KostAufG
  STRUKTUR.md          dieses Dokument
infra/
  compose.yaml         lokale Datenbank
  scripts/             Prüf- und Betriebsskripte
tests/e2e/             Ende-zu-Ende-Tests über die Oberfläche
.github/workflows/     CI
```

## Erlaubte API-Module

`health`, `organization`, `property`, `tenancy`, `metering`, `finance`, `banking`,
`documents`, `settlement`, `deadlines`, `tax`, `subscription`

Jedes Modul hat eine `index.ts`. Sie ist die einzige Datei, die andere Module
und der Rest der API importieren dürfen.

## Grenzen

| Regel | Bedeutung |
| --- | --- |
| Engine ist rein | `settlement-engine` importiert nichts außerhalb des eigenen Pakets: keine Datenbank, kein Netz, keine Node-Module. Eingabedaten rein, Ergebnis raus. |
| Pakete kennen keine Apps | Code unter `packages/` importiert nie aus `apps/`. |
| Apps kennen einander nicht | `web`, `api` und `worker` teilen Code nur über `packages/`. |
| Module nur über index | Ein API-Modul greift nie in die Interna eines anderen. |
| Keine Zyklen | Zirkuläre Importe sind verboten. |

## Regeln für Daten

- Jede fachliche Tabelle trägt `tenant_id` und eine RLS-Policy. Verweise zwischen
  Tabellen laufen über zusammengesetzte Fremdschlüssel `(tenant_id, id)`.
- Geld ist eine Ganzzahl in Cent (`bigint`), nie eine Gleitkommazahl.
- Was sich ändert und abgerechnet wird, ist zeitlich versioniert (Datumsbereich,
  Überlappungen verhindert die Datenbank).
- Migrationen sind SQL-Dateien in `packages/db/migrations/`. Eine angewendete
  Migration wird nie geändert; Korrekturen kommen als neue Datei.
