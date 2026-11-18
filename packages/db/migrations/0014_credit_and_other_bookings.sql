-- Tenant credit applied later and paid back, other bank bookings, and
-- cancelling a final settlement.

-- An allocation made after the payment (applying credit) carries the journal
-- entry that moved the amount from tenant credit to income. Allocations made
-- with the payment are part of the payment's own entry and leave this empty.
ALTER TABLE payment_allocation ADD COLUMN journal_entry_id uuid;
ALTER TABLE payment_allocation ADD FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entry (tenant_id, id);
-- One allocation per payment, charge and booking.
ALTER TABLE payment_allocation DROP CONSTRAINT payment_allocation_pkey;
CREATE UNIQUE INDEX payment_allocation_unique_idx ON payment_allocation (payment_id, charge_id, coalesce(journal_entry_id, '00000000-0000-0000-0000-000000000000'));

-- Money paid back to a tenant: an overpayment (tenant credit) or the credit of
-- an operating cost settlement.
CREATE TABLE credit_refund (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES organization (id),
  tenancy_id            uuid NOT NULL,
  reason                text NOT NULL CHECK (reason IN ('overpayment', 'settlement')),
  -- Set for reason settlement: whose credit is paid out.
  settlement_id         uuid,
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  paid_on               date NOT NULL,
  bank_transaction_id   uuid,
  journal_entry_id      uuid NOT NULL,
  reversal_entry_id     uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (journal_entry_id),
  CHECK ((reason = 'settlement') = (settlement_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, tenancy_id) REFERENCES tenancy (tenant_id, id),
  FOREIGN KEY (settlement_id, tenancy_id) REFERENCES settlement_statement (settlement_id, tenancy_id),
  FOREIGN KEY (tenant_id, bank_transaction_id) REFERENCES bank_transaction (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entry (tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_entry_id) REFERENCES journal_entry (tenant_id, id)
);
CREATE INDEX credit_refund_tenancy_idx ON credit_refund (tenancy_id);
CREATE UNIQUE INDEX credit_refund_bank_transaction_idx ON credit_refund (bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL AND reversal_entry_id IS NULL;
-- A settlement credit is paid out at most once.
CREATE UNIQUE INDEX credit_refund_settlement_idx ON credit_refund (settlement_id, tenancy_id)
  WHERE settlement_id IS NOT NULL AND reversal_entry_id IS NULL;

-- A bank transaction booked to an account directly: a deposit received, an
-- insurance refund, a private transfer.
CREATE TABLE bank_booking (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES organization (id),
  bank_transaction_id uuid NOT NULL,
  account_id          uuid NOT NULL,
  property_id         uuid,
  description         text CHECK (length(trim(description)) > 0),
  journal_entry_id    uuid NOT NULL,
  reversal_entry_id   uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (journal_entry_id),
  FOREIGN KEY (tenant_id, bank_transaction_id) REFERENCES bank_transaction (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES account (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES property (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entry (tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_entry_id) REFERENCES journal_entry (tenant_id, id)
);
CREATE UNIQUE INDEX bank_booking_transaction_idx ON bank_booking (bank_transaction_id) WHERE reversal_entry_id IS NULL;

-- A refund from the bank matches its transaction; a bank booking is never on
-- an ignored transaction.
CREATE FUNCTION credit_refund_check_bank() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bank_transaction_id IS NOT NULL AND NOT EXISTS (
    SELECT FROM bank_transaction t
    WHERE t.id = NEW.bank_transaction_id AND t.amount_cents = -NEW.amount_cents
      AND t.booking_date = NEW.paid_on AND t.ignored_at IS NULL
  ) THEN
    RAISE EXCEPTION 'refund % does not match its bank transaction', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_refund_bank BEFORE INSERT ON credit_refund FOR EACH ROW EXECUTE FUNCTION credit_refund_check_bank();

CREATE FUNCTION bank_booking_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT FROM bank_transaction t WHERE t.id = NEW.bank_transaction_id AND t.ignored_at IS NOT NULL) THEN
    RAISE EXCEPTION 'bank transaction % is ignored', NEW.bank_transaction_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_booking_check BEFORE INSERT ON bank_booking FOR EACH ROW EXECUTE FUNCTION bank_booking_check();

CREATE FUNCTION reversal_only_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reversal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION '% % is already reversed', TG_TABLE_NAME, OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_refund_reversal BEFORE UPDATE OF reversal_entry_id ON credit_refund FOR EACH ROW EXECUTE FUNCTION reversal_only_once();
CREATE TRIGGER bank_booking_reversal BEFORE UPDATE OF reversal_entry_id ON bank_booking FOR EACH ROW EXECUTE FUNCTION reversal_only_once();

-- A booked transaction cannot be ignored, whatever books it.
CREATE OR REPLACE FUNCTION bank_transaction_check_ignore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ignored_at IS NOT NULL AND (
    EXISTS (SELECT FROM payment p WHERE p.bank_transaction_id = NEW.id AND p.reversal_entry_id IS NULL)
    OR EXISTS (SELECT FROM expense e WHERE e.bank_transaction_id = NEW.id AND e.reversal_entry_id IS NULL)
    OR EXISTS (SELECT FROM credit_refund r WHERE r.bank_transaction_id = NEW.id AND r.reversal_entry_id IS NULL)
    OR EXISTS (SELECT FROM bank_booking b WHERE b.bank_transaction_id = NEW.id AND b.reversal_entry_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'bank transaction % is booked', NEW.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

-- A final settlement can be cancelled while nothing was paid on it; then the
-- period is free for a new one.
ALTER TABLE settlement ADD COLUMN cancelled_at timestamptz;
ALTER TABLE settlement DROP CONSTRAINT settlement_property_id_period_excl;
ALTER TABLE settlement ADD CONSTRAINT settlement_property_period_excl
  EXCLUDE USING gist (property_id WITH =, period WITH &&) WHERE (cancelled_at IS NULL);

CREATE FUNCTION settlement_check_cancel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'settlement % is already cancelled', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (SELECT FROM credit_refund r WHERE r.settlement_id = OLD.id AND r.reversal_entry_id IS NULL) THEN
    RAISE EXCEPTION 'settlement % has a credit paid out', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_cancel BEFORE UPDATE OF cancelled_at ON settlement FOR EACH ROW EXECUTE FUNCTION settlement_check_cancel();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credit_refund', 'bank_booking'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_record()', t || '_audit', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON credit_refund, bank_booking TO hv_app;
GRANT UPDATE (reversal_entry_id) ON credit_refund, bank_booking TO hv_app;
GRANT UPDATE (cancelled_at) ON settlement TO hv_app;
