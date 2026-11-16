-- Meters and their readings. A meter belongs to a unit or to a whole building.

CREATE TABLE meter (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES organization (id),
  unit_id       uuid,
  building_id   uuid,
  kind          text NOT NULL CHECK (kind IN ('electricity', 'gas', 'water_cold', 'water_hot', 'heat', 'other')),
  measure       text NOT NULL CHECK (measure IN ('kWh', 'MWh', 'm3', 'units')),
  serial_number text NOT NULL CHECK (length(trim(serial_number)) > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES unit (tenant_id, id),
  FOREIGN KEY (tenant_id, building_id) REFERENCES building (tenant_id, id),
  CHECK ((unit_id IS NULL) <> (building_id IS NULL))
);

CREATE TABLE meter_reading (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES organization (id),
  meter_id     uuid NOT NULL,
  reading_date date NOT NULL,
  -- Decimal, never floating point: readings are billed.
  value        numeric(14, 3) NOT NULL CHECK (value >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (meter_id, reading_date),
  FOREIGN KEY (tenant_id, meter_id) REFERENCES meter (tenant_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meter', 'meter_reading'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON meter, meter_reading TO hv_app;
