-- Bank accounts and imported bank transactions. An incoming transaction is
-- booked by recording a payment that points to it. Importing posts nothing.

CREATE TABLE bank_account (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES organization (id),
  iban        text NOT NULL CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, iban)
);

CREATE TABLE bank_transaction (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES organization (id),
  bank_account_id   uuid NOT NULL,
  -- Identifies the transaction within its account across imports.
  external_id       text NOT NULL CHECK (length(external_id) > 0),
  booking_date      date NOT NULL,
  value_date        date,
  -- Positive = incoming, negative = outgoing.
  amount_cents      bigint NOT NULL CHECK (amount_cents <> 0),
  counterparty_name text,
  counterparty_iban text,
  remittance_info   text NOT NULL DEFAULT '',
  -- Set when the user decides the transaction needs no booking here.
  ignored_at        timestamptz,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (bank_account_id, external_id),
  FOREIGN KEY (tenant_id, bank_account_id) REFERENCES bank_account (tenant_id, id)
);
CREATE INDEX bank_transaction_counterparty_idx ON bank_transaction (tenant_id, counterparty_iban);

ALTER TABLE payment ADD COLUMN bank_transaction_id uuid;
ALTER TABLE payment ADD FOREIGN KEY (tenant_id, bank_transaction_id) REFERENCES bank_transaction (tenant_id, id);
-- A transaction is booked by at most one payment in force.
CREATE UNIQUE INDEX payment_bank_transaction_idx ON payment (bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL AND reversal_entry_id IS NULL;

-- A payment from the bank has the transaction's amount and booking date, and
-- an ignored transaction is not booked.
CREATE FUNCTION payment_check_bank_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bank_transaction_id IS NOT NULL AND NOT EXISTS (
    SELECT FROM bank_transaction t
    WHERE t.id = NEW.bank_transaction_id AND t.amount_cents = NEW.amount_cents
      AND t.booking_date = NEW.received_on AND t.ignored_at IS NULL
  ) THEN
    RAISE EXCEPTION 'payment % does not match its bank transaction', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payment_bank_transaction BEFORE INSERT ON payment
  FOR EACH ROW EXECUTE FUNCTION payment_check_bank_transaction();

CREATE FUNCTION bank_transaction_check_ignore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ignored_at IS NOT NULL AND EXISTS (
    SELECT FROM payment p WHERE p.bank_transaction_id = NEW.id AND p.reversal_entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'bank transaction % is booked', NEW.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER bank_transaction_ignore BEFORE UPDATE OF ignored_at ON bank_transaction
  FOR EACH ROW EXECUTE FUNCTION bank_transaction_check_ignore();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_account', 'bank_transaction'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT ON bank_account, bank_transaction TO hv_app;
GRANT UPDATE (ignored_at) ON bank_transaction TO hv_app;
