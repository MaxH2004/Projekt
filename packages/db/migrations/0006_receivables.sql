-- Rent charges, payments and their allocation: the open items of a tenancy.
--
-- Charges are a subledger and post nothing: the income statement under § 21
-- EStG is cash based, so income is booked when a payment arrives. A payment
-- posts one journal entry; reversing it posts the reversing entry and its
-- allocations stop counting. Allocations are never changed or deleted.

CREATE TABLE rent_charge (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES organization (id),
  tenancy_id   uuid NOT NULL,
  -- First day of the month the charge is for.
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  kind         text NOT NULL CHECK (kind IN ('base_rent', 'operating_cost_advance', 'heating_cost_advance')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  due_date     date NOT NULL,
  cancelled_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, tenancy_id, id),
  FOREIGN KEY (tenant_id, tenancy_id) REFERENCES tenancy (tenant_id, id),
  -- Generating a month twice creates nothing new.
  UNIQUE (tenancy_id, period_month, kind)
);

CREATE TABLE payment (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES organization (id),
  tenancy_id        uuid NOT NULL,
  received_on       date NOT NULL,
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  reference         text CHECK (length(trim(reference)) > 0),
  journal_entry_id  uuid NOT NULL,
  reversal_entry_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, tenancy_id, id),
  UNIQUE (journal_entry_id),
  FOREIGN KEY (tenant_id, tenancy_id) REFERENCES tenancy (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entry (tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_entry_id) REFERENCES journal_entry (tenant_id, id)
);

-- Payment and charge must belong to the same tenancy: both foreign keys
-- include tenancy_id.
CREATE TABLE payment_allocation (
  tenant_id    uuid NOT NULL REFERENCES organization (id),
  tenancy_id   uuid NOT NULL,
  payment_id   uuid NOT NULL,
  charge_id    uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (payment_id, charge_id),
  FOREIGN KEY (tenant_id, tenancy_id, payment_id) REFERENCES payment (tenant_id, tenancy_id, id),
  FOREIGN KEY (tenant_id, tenancy_id, charge_id) REFERENCES rent_charge (tenant_id, tenancy_id, id)
);
CREATE INDEX payment_allocation_charge_idx ON payment_allocation (charge_id);

-- Checked at commit: no payment is allocated beyond its amount, no charge is
-- covered beyond its amount, and no cancelled charge receives money.
CREATE FUNCTION payment_allocation_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT sum(a.amount_cents) FROM payment_allocation a WHERE a.payment_id = NEW.payment_id)
     > (SELECT p.amount_cents FROM payment p WHERE p.id = NEW.payment_id) THEN
    RAISE EXCEPTION 'payment % is allocated beyond its amount', NEW.payment_id USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT sum(a.amount_cents) FROM payment_allocation a JOIN payment p ON p.id = a.payment_id
      WHERE a.charge_id = NEW.charge_id AND p.reversal_entry_id IS NULL)
     > (SELECT c.amount_cents FROM rent_charge c WHERE c.id = NEW.charge_id) THEN
    RAISE EXCEPTION 'charge % is covered beyond its amount', NEW.charge_id USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT c.cancelled_at IS NOT NULL FROM rent_charge c WHERE c.id = NEW.charge_id) THEN
    RAISE EXCEPTION 'charge % is cancelled', NEW.charge_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER payment_allocation_within_amounts AFTER INSERT ON payment_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payment_allocation_check();

-- A charge with money on it cannot be cancelled; a payment cannot be un-reversed.
CREATE FUNCTION rent_charge_check_cancel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'charge % is already cancelled', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT FROM payment_allocation a JOIN payment p ON p.id = a.payment_id
    WHERE a.charge_id = OLD.id AND p.reversal_entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'charge % has payments allocated', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER rent_charge_cancel BEFORE UPDATE OF cancelled_at ON rent_charge
  FOR EACH ROW EXECUTE FUNCTION rent_charge_check_cancel();

CREATE FUNCTION payment_check_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reversal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'payment % is already reversed', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payment_reversal BEFORE UPDATE OF reversal_entry_id ON payment
  FOR EACH ROW EXECUTE FUNCTION payment_check_reversal();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rent_charge', 'payment', 'payment_allocation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- Only the fields that may change can be updated; nothing can be deleted.
GRANT SELECT, INSERT ON rent_charge, payment, payment_allocation TO hv_app;
GRANT UPDATE (cancelled_at) ON rent_charge TO hv_app;
GRANT UPDATE (reversal_entry_id) ON payment TO hv_app;
