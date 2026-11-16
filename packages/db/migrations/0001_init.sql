-- Grundgerüst: Mandant, Objekt, Gebäude, Einheit, zeitlich versionierte Fläche.
-- Jede fachliche Tabelle trägt tenant_id (Mandant der Software, nicht der Mieter)
-- und ist per Row-Level Security auf den Mandanten der Transaktion begrenzt.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Rolle der Anwendung. Sie besitzt keine Tabellen und kann RLS nicht umgehen.
-- Login-Benutzer der Umgebung werden Mitglied dieser Rolle.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hv_app') THEN
    CREATE ROLE hv_app NOLOGIN;
  END IF;
END $$;

-- Mandant der aktuellen Transaktion; NULL, wenn keiner gesetzt ist.
CREATE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE organization (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE property (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES organization (id),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  -- Eigentumsform ist ab Stufe 1 im Modell, WEG wird ab Stufe 3 befüllt.
  ownership_form text NOT NULL DEFAULT 'rental' CHECK (ownership_form IN ('rental', 'weg')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE building (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES organization (id),
  property_id uuid NOT NULL,
  street      text NOT NULL,
  postal_code text NOT NULL,
  city        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- Zusammengesetzter Fremdschlüssel: ein Gebäude kann nie auf das Objekt
  -- eines anderen Mandanten zeigen.
  FOREIGN KEY (tenant_id, property_id) REFERENCES property (tenant_id, id)
);

CREATE TABLE unit (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES organization (id),
  building_id uuid NOT NULL,
  label       text NOT NULL CHECK (length(trim(label)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, building_id, label),
  FOREIGN KEY (tenant_id, building_id) REFERENCES building (tenant_id, id)
);

-- Zeitlich versionierte Fläche: eine Abrechnung für 2025 sieht die Werte von 2025.
-- Fläche als Ganzzahl in Hundertstel-m² (54,37 m² = 5437).
CREATE TABLE unit_area (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES organization (id),
  unit_id     uuid NOT NULL,
  area_centi_sqm integer NOT NULL CHECK (area_centi_sqm > 0),
  -- Halboffen [gültig ab, gültig bis); obere Grenze offen = gilt weiter.
  valid       daterange NOT NULL CHECK (NOT isempty(valid) AND lower(valid) IS NOT NULL),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES unit (tenant_id, id),
  -- Keine zwei Flächen derselben Einheit dürfen sich zeitlich überschneiden.
  EXCLUDE USING gist (unit_id WITH =, valid WITH &&)
);

-- Row-Level Security. FORCE gilt auch für den Tabelleneigentümer.
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['property', 'building', 'unit', 'unit_area'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO hv_app;
GRANT SELECT ON organization TO hv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON property, building, unit, unit_area TO hv_app;
