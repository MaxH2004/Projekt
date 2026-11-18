-- Sender and bank details of an organization, printed on letters. One row
-- per organization, created on first save.

CREATE TABLE organization_details (
  tenant_id      uuid NOT NULL REFERENCES organization (id),
  street         text CHECK (length(trim(street)) > 0),
  postal_code    text CHECK (length(trim(postal_code)) > 0),
  city           text CHECK (length(trim(city)) > 0),
  account_holder text CHECK (length(trim(account_holder)) > 0),
  -- Without spaces; the check digits are validated by the application.
  iban           text CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id)
);

ALTER TABLE organization_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_details FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_details
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON organization_details TO hv_app;
