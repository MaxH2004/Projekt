-- Expenses: money paid for a property, split into lines by cost account,
-- property and operating cost category. An expense posts one journal entry
-- when recorded (cash basis); a correction is a reversal.

CREATE TABLE expense (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES organization (id),
  paid_on             date NOT NULL,
  -- Sum of the lines; checked at commit.
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  -- bank: from the landlord's bank account; private: paid from private money.
  paid_from           text NOT NULL CHECK (paid_from IN ('bank', 'private')),
  vendor              text CHECK (length(trim(vendor)) > 0),
  description         text CHECK (length(trim(description)) > 0),
  bank_transaction_id uuid,
  journal_entry_id    uuid NOT NULL,
  reversal_entry_id   uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (journal_entry_id),
  CHECK (bank_transaction_id IS NULL OR paid_from = 'bank'),
  FOREIGN KEY (tenant_id, bank_transaction_id) REFERENCES bank_transaction (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES journal_entry (tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_entry_id) REFERENCES journal_entry (tenant_id, id)
);
CREATE UNIQUE INDEX expense_bank_transaction_idx ON expense (bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL AND reversal_entry_id IS NULL;

CREATE TABLE expense_line (
  id                      uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES organization (id),
  expense_id              uuid NOT NULL,
  account_id              uuid NOT NULL,
  property_id             uuid NOT NULL,
  amount_cents            bigint NOT NULL CHECK (amount_cents > 0),
  -- Category of § 2 BetrKV if the line may go into an operating cost settlement.
  operating_cost_category text CHECK (operating_cost_category IN (
    'public_charges', 'water_supply', 'drainage', 'heating', 'hot_water', 'combined_heating_hot_water',
    'lift', 'street_cleaning_waste', 'building_cleaning_pest_control', 'garden', 'lighting',
    'chimney_cleaning', 'insurance', 'caretaker', 'antenna_broadband', 'laundry_facilities', 'other')),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, expense_id) REFERENCES expense (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES account (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES property (tenant_id, id)
);
CREATE INDEX expense_line_expense_idx ON expense_line (expense_id);
CREATE INDEX expense_line_property_idx ON expense_line (property_id);

-- Checked at commit: the lines add up to the expense, every line books to an
-- expense account, and an expense from a bank transaction matches it.
CREATE FUNCTION expense_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT coalesce(sum(l.amount_cents), 0) FROM expense_line l WHERE l.expense_id = NEW.id) <> NEW.amount_cents THEN
    RAISE EXCEPTION 'lines of expense % do not add up to its amount', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT FROM expense_line l JOIN account a ON a.id = l.account_id WHERE l.expense_id = NEW.id AND a.type <> 'expense') THEN
    RAISE EXCEPTION 'expense % books to an account that is not an expense account', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.bank_transaction_id IS NOT NULL AND NOT EXISTS (
    SELECT FROM bank_transaction t
    WHERE t.id = NEW.bank_transaction_id AND t.amount_cents = -NEW.amount_cents
      AND t.booking_date = NEW.paid_on AND t.ignored_at IS NULL
  ) THEN
    RAISE EXCEPTION 'expense % does not match its bank transaction', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER expense_consistent AFTER INSERT ON expense
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION expense_check();

-- Lines belong to the transaction that created their expense.
CREATE FUNCTION expense_line_check_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM expense e JOIN journal_entry j ON j.id = e.journal_entry_id
    WHERE e.id = NEW.expense_id AND j.created_xact = pg_current_xact_id()
  ) THEN
    RAISE EXCEPTION 'expense % is already recorded', NEW.expense_id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER expense_line_open BEFORE INSERT ON expense_line
  FOR EACH ROW EXECUTE FUNCTION expense_line_check_open();

CREATE FUNCTION expense_check_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reversal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'expense % is already reversed', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER expense_reversal BEFORE UPDATE OF reversal_entry_id ON expense
  FOR EACH ROW EXECUTE FUNCTION expense_check_reversal();

-- A booked transaction cannot be ignored, whether a payment or an expense books it.
CREATE OR REPLACE FUNCTION bank_transaction_check_ignore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ignored_at IS NOT NULL AND (
    EXISTS (SELECT FROM payment p WHERE p.bank_transaction_id = NEW.id AND p.reversal_entry_id IS NULL)
    OR EXISTS (SELECT FROM expense e WHERE e.bank_transaction_id = NEW.id AND e.reversal_entry_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'bank transaction % is booked', NEW.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense', 'expense_line'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT ON expense, expense_line TO hv_app;
GRANT UPDATE (reversal_entry_id) ON expense TO hv_app;
