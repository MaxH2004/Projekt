-- Audit log: every change to financial data, with the user who made it.
-- Written only by the trigger below, which runs with the rights of its owner;
-- the application role can read the log but not write, change or delete it.

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES organization (id),
  at         timestamptz NOT NULL DEFAULT now(),
  -- Set by the API per transaction (app.user_id); null for maintenance jobs.
  user_id    uuid,
  table_name text NOT NULL,
  row_id     text,
  action     text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  old_row    jsonb,
  new_row    jsonb
);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, id DESC);

CREATE FUNCTION audit_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_json jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  new_json jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  row_json jsonb := coalesce(new_json, old_json);
BEGIN
  INSERT INTO audit_log (tenant_id, user_id, table_name, row_id, action, old_row, new_row)
  VALUES (
    (row_json ->> 'tenant_id')::uuid,
    nullif(current_setting('app.user_id', true), '')::uuid,
    TG_TABLE_NAME,
    coalesce(row_json ->> 'id', row_json ->> 'tenancy_id'),
    lower(TG_OP),
    old_json,
    new_json
  );
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account', 'journal_entry', 'tenancy', 'rent_component', 'rent_charge', 'payment', 'payment_allocation',
    'bank_transaction', 'expense', 'expense_line', 'settlement', 'settlement_statement', 'organization_details'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_record()', t || '_audit', t);
  END LOOP;
END $$;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Read only for the application. The trigger function inserts as its owner.
GRANT SELECT ON audit_log TO hv_app;
REVOKE ALL ON FUNCTION audit_record() FROM PUBLIC;

CREATE FUNCTION audit_log_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit log is append-only' USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
