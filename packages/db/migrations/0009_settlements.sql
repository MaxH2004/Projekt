-- Final operating cost settlements. A settlement is stored once with the
-- input it was calculated from, the result and the rule set, and is never
-- changed. A balance the tenant owes becomes a charge of kind
-- settlement_balance.

CREATE TABLE settlement (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES organization (id),
  property_id  uuid NOT NULL,
  period       daterange NOT NULL CHECK (NOT isempty(period) AND lower(period) IS NOT NULL AND upper(period) IS NOT NULL),
  rule_set_id  text NOT NULL CHECK (length(rule_set_id) > 0),
  due_date     date NOT NULL,
  -- What went into the engine and what came out, amounts as strings.
  input        jsonb NOT NULL,
  result       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES property (tenant_id, id),
  -- A property is settled at most once for any day; there is no correction yet.
  EXCLUDE USING gist (property_id WITH =, period WITH &&)
);

CREATE TABLE settlement_statement (
  tenant_id           uuid NOT NULL REFERENCES organization (id),
  settlement_id       uuid NOT NULL,
  tenancy_id          uuid NOT NULL,
  total_cents         bigint NOT NULL,
  advances_paid_cents bigint NOT NULL,
  -- Positive: the tenant owes it. Negative: the tenant gets it back.
  balance_cents       bigint NOT NULL CHECK (balance_cents = total_cents - advances_paid_cents),
  charge_id           uuid,
  PRIMARY KEY (settlement_id, tenancy_id),
  UNIQUE (charge_id),
  CHECK ((charge_id IS NOT NULL) = (balance_cents > 0)),
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlement (tenant_id, id),
  FOREIGN KEY (tenant_id, tenancy_id) REFERENCES tenancy (tenant_id, id),
  FOREIGN KEY (tenant_id, tenancy_id, charge_id) REFERENCES rent_charge (tenant_id, tenancy_id, id)
);
CREATE INDEX settlement_statement_tenancy_idx ON settlement_statement (tenancy_id);

ALTER TABLE rent_charge DROP CONSTRAINT rent_charge_kind_check;
ALTER TABLE rent_charge ADD CONSTRAINT rent_charge_kind_check
  CHECK (kind IN ('base_rent', 'operating_cost_advance', 'heating_cost_advance', 'settlement_balance'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settlement', 'settlement_statement'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- Final means final: no UPDATE or DELETE, not even by privilege.
GRANT SELECT, INSERT ON settlement, settlement_statement TO hv_app;
