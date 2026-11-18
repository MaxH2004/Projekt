-- Deposit of a tenancy and the number of people living in the unit over time.

-- What the contract says about the deposit. Payments of it are booked as bank
-- bookings to 355000; interest on it is not calculated.
ALTER TABLE tenancy ADD COLUMN deposit_cents bigint CHECK (deposit_cents >= 0);
ALTER TABLE tenancy ADD COLUMN deposit_held text CHECK (length(trim(deposit_held)) > 0);

-- People living in the unit, versioned in time like rent and area. Used to
-- prefill the persons key of an operating cost settlement.
CREATE TABLE tenancy_occupants (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES organization (id),
  tenancy_id  uuid NOT NULL,
  persons     integer NOT NULL CHECK (persons BETWEEN 0 AND 99),
  valid       daterange NOT NULL CHECK (NOT isempty(valid) AND lower(valid) IS NOT NULL),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, tenancy_id) REFERENCES tenancy (tenant_id, id),
  EXCLUDE USING gist (tenancy_id WITH =, valid WITH &&)
);

ALTER TABLE tenancy_occupants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy_occupants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenancy_occupants
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE TRIGGER tenancy_occupants_audit AFTER INSERT OR UPDATE OR DELETE ON tenancy_occupants FOR EACH ROW EXECUTE FUNCTION audit_record();

GRANT SELECT, INSERT, UPDATE, DELETE ON tenancy_occupants TO hv_app;
