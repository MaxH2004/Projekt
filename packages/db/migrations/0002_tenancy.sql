-- Persons, tenancies and time-versioned rent components.

CREATE TABLE person (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES organization (id),
  kind         text NOT NULL CHECK (kind IN ('natural', 'legal')),
  given_name   text,
  family_name  text,
  company_name text,
  email        text,
  phone        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  CHECK (
    -- coalesce: a NULL name must fail the check instead of leaving it undecided.
    (kind = 'natural' AND length(trim(coalesce(family_name, ''))) > 0 AND company_name IS NULL)
    OR (kind = 'legal' AND length(trim(coalesce(company_name, ''))) > 0 AND given_name IS NULL AND family_name IS NULL)
  )
);

CREATE TABLE tenancy (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES organization (id),
  unit_id     uuid NOT NULL,
  -- Half-open [first day, day after the last day); open upper bound = ongoing.
  term        daterange NOT NULL CHECK (NOT isempty(term) AND lower(term) IS NOT NULL),
  rent_type   text NOT NULL DEFAULT 'fixed' CHECK (rent_type IN ('fixed', 'graduated', 'indexed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES unit (tenant_id, id),
  -- A unit has at most one tenancy on any given day.
  EXCLUDE USING gist (unit_id WITH =, term WITH &&)
);

CREATE TABLE tenancy_party (
  tenant_id   uuid NOT NULL REFERENCES organization (id),
  tenancy_id  uuid NOT NULL,
  person_id   uuid NOT NULL,
  role        text NOT NULL DEFAULT 'tenant' CHECK (role IN ('tenant', 'guarantor')),
  PRIMARY KEY (tenancy_id, person_id),
  FOREIGN KEY (tenant_id, tenancy_id) REFERENCES tenancy (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES person (tenant_id, id)
);

-- Monthly amounts per component. A rent change closes the current row and
-- adds a new one, so a settlement for 2025 sees the amounts of 2025.
CREATE TABLE rent_component (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES organization (id),
  tenancy_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('base_rent', 'operating_cost_advance', 'heating_cost_advance')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  valid        daterange NOT NULL CHECK (NOT isempty(valid) AND lower(valid) IS NOT NULL),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, tenancy_id) REFERENCES tenancy (tenant_id, id),
  -- One amount per component and day.
  EXCLUDE USING gist (tenancy_id WITH =, kind WITH =, valid WITH &&)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['person', 'tenancy', 'tenancy_party', 'rent_component'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON person, tenancy, tenancy_party, rent_component TO hv_app;
