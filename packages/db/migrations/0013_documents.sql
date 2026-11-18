-- Uploaded files: receipts of expenses and documents of a property or
-- tenancy. The bytes are in the file storage under storage_key; this table
-- holds what the application knows about them.

CREATE TABLE document (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES organization (id),
  property_id  uuid,
  tenancy_id   uuid,
  expense_id   uuid,
  kind         text NOT NULL CHECK (kind IN ('receipt', 'contract', 'correspondence', 'other')),
  -- As uploaded, for display and download; never used as a path.
  file_name    text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  -- Detected from the content, not taken from the upload.
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  sha256       bytea NOT NULL CHECK (length(sha256) = 32),
  storage_key  text NOT NULL UNIQUE,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- Every document belongs to something.
  CHECK (num_nonnulls(property_id, tenancy_id, expense_id) >= 1),
  FOREIGN KEY (tenant_id, property_id) REFERENCES property (tenant_id, id),
  FOREIGN KEY (tenant_id, tenancy_id) REFERENCES tenancy (tenant_id, id),
  FOREIGN KEY (tenant_id, expense_id) REFERENCES expense (tenant_id, id)
);
CREATE INDEX document_property_idx ON document (property_id);
CREATE INDEX document_tenancy_idx ON document (tenancy_id);
CREATE INDEX document_expense_idx ON document (expense_id);

-- A receipt of an expense is part of the books and cannot be removed.
CREATE FUNCTION document_check_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.expense_id IS NOT NULL THEN
    RAISE EXCEPTION 'document % is the receipt of an expense', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER document_delete BEFORE DELETE ON document FOR EACH ROW EXECUTE FUNCTION document_check_delete();

CREATE TRIGGER document_audit AFTER INSERT OR UPDATE OR DELETE ON document FOR EACH ROW EXECUTE FUNCTION audit_record();

ALTER TABLE document ENABLE ROW LEVEL SECURITY;
ALTER TABLE document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, DELETE ON document TO hv_app;
