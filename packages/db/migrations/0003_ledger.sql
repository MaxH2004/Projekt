-- Double-entry ledger. Entries and lines are immutable: corrections are made
-- by a reversing entry, never by UPDATE or DELETE.

CREATE TABLE account (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES organization (id),
  code        text NOT NULL CHECK (length(trim(code)) > 0),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  type        text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE journal_entry (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES organization (id),
  booking_date      date NOT NULL,
  description       text NOT NULL CHECK (length(trim(description)) > 0),
  -- Set on a reversing entry; an entry can be reversed at most once.
  reverses_entry_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Transaction that created the entry. Lines can only be added within it.
  created_xact      xid8 NOT NULL DEFAULT pg_current_xact_id(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, reverses_entry_id),
  FOREIGN KEY (tenant_id, reverses_entry_id) REFERENCES journal_entry (tenant_id, id),
  CHECK (reverses_entry_id <> id)
);

CREATE TABLE journal_line (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES organization (id),
  entry_id     uuid NOT NULL,
  account_id   uuid NOT NULL,
  -- Positive = debit, negative = credit.
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  -- Optional cost centre.
  property_id  uuid,
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES journal_entry (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES account (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES property (tenant_id, id)
);
CREATE INDEX journal_line_entry_idx ON journal_line (entry_id);
CREATE INDEX journal_line_account_idx ON journal_line (account_id);

CREATE FUNCTION ledger_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger is immutable: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER journal_entry_immutable BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER journal_line_immutable BEFORE UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER journal_entry_no_truncate BEFORE TRUNCATE ON journal_entry
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER journal_line_no_truncate BEFORE TRUNCATE ON journal_line
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();

-- A line may only join an entry created in the same transaction. Together
-- with the balance check at commit this freezes every committed entry.
CREATE FUNCTION journal_line_check_open_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM journal_entry e
    WHERE e.id = NEW.entry_id AND e.created_xact = pg_current_xact_id()
  ) THEN
    RAISE EXCEPTION 'ledger is immutable: entry % is already committed', NEW.entry_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER journal_line_open_entry BEFORE INSERT ON journal_line
  FOR EACH ROW EXECUTE FUNCTION journal_line_check_open_entry();

-- Checked at commit: every entry has lines that sum to zero, and a reversing
-- entry mirrors the entry it reverses exactly.
CREATE FUNCTION journal_entry_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_count integer;
  balance numeric;
BEGIN
  SELECT count(*), coalesce(sum(amount_cents), 0) INTO line_count, balance
  FROM journal_line WHERE entry_id = NEW.id;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'journal entry % needs at least two lines', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF balance <> 0 THEN
    RAISE EXCEPTION 'journal entry % is not balanced (difference % cents)', NEW.id, balance
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lines of the reversal and negated lines of the original must cancel out
  -- as multisets of (account, cost centre, amount).
  IF NEW.reverses_entry_id IS NOT NULL AND EXISTS (
    SELECT FROM (
      SELECT account_id, property_id, amount_cents AS amount, 1 AS side
      FROM journal_line WHERE entry_id = NEW.id
      UNION ALL
      SELECT account_id, property_id, -amount_cents, -1
      FROM journal_line WHERE entry_id = NEW.reverses_entry_id
    ) lines
    GROUP BY account_id, property_id, amount
    HAVING sum(side) <> 0
  ) THEN
    RAISE EXCEPTION 'journal entry % does not mirror the entry it reverses', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER journal_entry_balanced AFTER INSERT ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_check_balanced();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account', 'journal_entry', 'journal_line'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON account TO hv_app;
-- No UPDATE or DELETE on the journal, not even by privilege.
GRANT SELECT, INSERT ON journal_entry, journal_line TO hv_app;
