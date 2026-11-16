# 0001 – Stack und Struktur

Stand: 2026-11-16

## Entscheidung

- Modularer Monolith in TypeScript als pnpm-Workspace, Struktur laut `docs/STRUKTUR.md`.
- Backend NestJS, Frontend Next.js, Datenbank PostgreSQL 16.
- Mandantentrennung über Row-Level Security; der Mandant wird je Transaktion gesetzt.
- Migrationen als reine SQL-Dateien, weil RLS-Policies und Ausschluss-Constraints
  ohnehin in SQL geschrieben werden.
- Abrechnungs-Engine als reines Paket ohne Abhängigkeiten.
- Bankdaten hinter einer Adapter-Schnittstelle. PSD2 ist als Anbieter vorbereitet,
  aber nicht angeschlossen.
- Hosting: zuerst ein Testserver mit Docker, später STACKIT.

## Offen

- Abfrageschicht in der API (Drizzle oder Kysely auf dem SQL-Schema).
- Auth-Bibliothek mit 2FA.
- Job-Queue (Vorschlag: pg-boss).
- Wie Mandanten angelegt werden, wenn die Datenbank keinen Superuser bietet
  (bei verwalteten Datenbanken üblich).
- OCR-Anbieter mit Verarbeitung in der EU.
