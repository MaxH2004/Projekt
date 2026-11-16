import type { PoolClient } from "pg";

export interface JournalLineInput {
  readonly accountId: string;
  /** Positive = debit, negative = credit. */
  readonly amountCents: bigint;
  /** Optional cost centre. */
  readonly propertyId?: string;
}

export interface JournalEntryInput {
  readonly bookingDate: string;
  readonly description: string;
  readonly lines: readonly JournalLineInput[];
}

/**
 * Posts a journal entry inside the caller's tenant transaction and returns its
 * id. The database checks the balance; this function makes that check run
 * immediately instead of at commit, so the caller gets the error here.
 */
export async function postJournalEntry(client: PoolClient, tenantId: string, entry: JournalEntryInput): Promise<string> {
  const id = (
    await client.query<{ id: string }>(
      "INSERT INTO journal_entry (tenant_id, booking_date, description) VALUES ($1, $2, $3) RETURNING id",
      [tenantId, entry.bookingDate, entry.description],
    )
  ).rows[0]!.id;
  for (const line of entry.lines) {
    await client.query(
      "INSERT INTO journal_line (tenant_id, entry_id, account_id, amount_cents, property_id) VALUES ($1, $2, $3, $4, $5)",
      [tenantId, id, line.accountId, line.amountCents.toString(), line.propertyId ?? null],
    );
  }
  await checkNow(client);
  return id;
}

/**
 * Posts the reversing entry for `entryId`: the same lines with opposite signs.
 * An entry can be reversed only once.
 */
export async function reverseJournalEntry(
  client: PoolClient,
  tenantId: string,
  entryId: string,
  reversal: { bookingDate: string; description: string },
): Promise<string> {
  const id = (
    await client.query<{ id: string }>(
      "INSERT INTO journal_entry (tenant_id, booking_date, description, reverses_entry_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [tenantId, reversal.bookingDate, reversal.description, entryId],
    )
  ).rows[0]!.id;
  await client.query(
    `INSERT INTO journal_line (tenant_id, entry_id, account_id, amount_cents, property_id)
     SELECT tenant_id, $1, account_id, -amount_cents, property_id FROM journal_line WHERE entry_id = $2`,
    [id, entryId],
  );
  await checkNow(client);
  return id;
}

async function checkNow(client: PoolClient): Promise<void> {
  await client.query("SET CONSTRAINTS journal_entry_balanced IMMEDIATE");
  await client.query("SET CONSTRAINTS journal_entry_balanced DEFERRED");
}
