# Hausverwaltung

Software für Mietverwaltung, zuerst für private Vermieter in Deutschland.

## Verbindlich

- Die Ordnerstruktur und die Modulgrenzen stehen in `docs/STRUKTUR.md`. Keine
  neuen Ordner auf den dort genannten Ebenen ohne Eintrag in `docs/adr/`.
- Vor jedem Commit muss `pnpm verify` grün sein.
- Fachliche Rechenregeln (BetrKV, HeizkostenV, CO2KostAufG) nie aus dem Gedächtnis
  umsetzen: nur mit Quelle in `docs/fachlogik/` und Testfall in
  `packages/settlement-engine/fixtures/`.
- Keine echten Mieter- oder Bankdaten und keine Zugangsdaten im Repository.

## Befehle

- `pnpm install`
- `pnpm verify` – Struktur, Build, Typen, Grenzen, Tests
- `pnpm db:migrate` – braucht `DATABASE_URL`
- Tests in `packages/db` brauchen `TEST_DATABASE_URL`; der Datenbankname muss auf
  `_test` enden, weil die Tests das Schema zurücksetzen. Lokale Datenbank:
  `docker compose -f infra/compose.yaml up -d`

## Konventionen

- Bezeichner im Code englisch, Oberfläche, Fehlermeldungen und Kommentare deutsch.
- Geld als `bigint` in Cent. Verteilungen nur über `allocate` aus der Engine.
