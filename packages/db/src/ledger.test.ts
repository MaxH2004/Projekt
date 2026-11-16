import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postJournalEntry, reverseJournalEntry, withTenant } from "./index.js";
import { asAdmin, resetDatabase, testDatabaseUrl, type SeededTenant } from "./test-support.js";

const pool = new pg.Pool({ connectionString: testDatabaseUrl() });
let a: SeededTenant;
let b: SeededTenant;
let bank: string;
let receivable: string;
let rentIncome: string;
let bankOfB: string;
let rentEntry: string;

const inA = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(pool, a.org, fn);
const createAccount = (tenant: string, code: string, name: string, type: string) =>
  withTenant(pool, tenant, async (c) =>
    (await c.query<{ id: string }>("INSERT INTO account (tenant_id, code, name, type) VALUES ($1, $2, $3, $4) RETURNING id", [tenant, code, name, type])).rows[0]!.id);
const linesOf = (entry: string) =>
  inA(async (c) => (await c.query("SELECT account_id, amount_cents FROM journal_line WHERE entry_id = $1 ORDER BY amount_cents", [entry])).rows);
const entryCount = () => inA(async (c) => Number((await c.query("SELECT count(*) AS n FROM journal_entry")).rows[0].n));

beforeAll(async () => {
  ({ a, b } = await resetDatabase(pool));
  bank = await createAccount(a.org, "1000", "Bank", "asset");
  receivable = await createAccount(a.org, "1200", "Rent receivable", "asset");
  rentIncome = await createAccount(a.org, "4000", "Rent income", "income");
  bankOfB = await createAccount(b.org, "1000", "Bank", "asset");
});

afterAll(() => pool.end());

describe("posting", () => {
  it("stores a balanced entry", async () => {
    rentEntry = await inA((c) =>
      postJournalEntry(c, a.org, {
        bookingDate: "2025-04-01",
        description: "Rent charge April",
        lines: [
          { accountId: receivable, amountCents: 95_000n, propertyId: a.property },
          { accountId: rentIncome, amountCents: -95_000n, propertyId: a.property },
        ],
      }));
    expect(await linesOf(rentEntry)).toEqual([
      { account_id: rentIncome, amount_cents: "-95000" },
      { account_id: receivable, amount_cents: "95000" },
    ]);
  });

  it("rejects an unbalanced entry and stores nothing", async () => {
    const before = await entryCount();
    await expect(
      inA((c) =>
        postJournalEntry(c, a.org, {
          bookingDate: "2025-04-03",
          description: "Off by one cent",
          lines: [
            { accountId: bank, amountCents: 95_000n },
            { accountId: receivable, amountCents: -94_999n },
          ],
        })),
    ).rejects.toThrow(/not balanced \(difference 1 cents\)/);
    expect(await entryCount()).toBe(before);
  });

  it("rejects an entry without lines", async () => {
    await expect(inA((c) => postJournalEntry(c, a.org, { bookingDate: "2025-04-03", description: "Empty", lines: [] }))).rejects.toThrow(/at least two lines/);
  });

  it("checks the balance at commit even when the helper is bypassed", async () => {
    const before = await entryCount();
    await expect(
      inA(async (c) => {
        const id = (await c.query<{ id: string }>("INSERT INTO journal_entry (tenant_id, booking_date, description) VALUES ($1, '2025-04-03', 'Raw SQL') RETURNING id", [a.org])).rows[0]!.id;
        await c.query("INSERT INTO journal_line (tenant_id, entry_id, account_id, amount_cents) VALUES ($1, $2, $3, 100), ($1, $2, $4, -99)", [a.org, id, bank, receivable]);
      }),
    ).rejects.toThrow(/not balanced/);
    expect(await entryCount()).toBe(before);
  });

  it("rejects zero amounts", async () => {
    await expect(
      inA((c) =>
        postJournalEntry(c, a.org, {
          bookingDate: "2025-04-03",
          description: "Zero",
          lines: [{ accountId: bank, amountCents: 0n }, { accountId: receivable, amountCents: 0n }],
        })),
    ).rejects.toThrow(/check constraint/);
  });

  it("rejects a line on another tenant's account", async () => {
    await expect(
      inA((c) =>
        postJournalEntry(c, a.org, {
          bookingDate: "2025-04-03",
          description: "Foreign account",
          lines: [{ accountId: bankOfB, amountCents: 100n }, { accountId: receivable, amountCents: -100n }],
        })),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("immutability", () => {
  it("denies the application role UPDATE and DELETE", async () => {
    for (const sql of [
      "UPDATE journal_line SET amount_cents = 1",
      "DELETE FROM journal_line",
      "UPDATE journal_entry SET description = 'changed'",
      "DELETE FROM journal_entry",
    ]) {
      await expect(inA((c) => c.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it("blocks UPDATE, DELETE and TRUNCATE even for the schema owner", async () => {
    await asAdmin(async (admin) => {
      await admin.query("ALTER TABLE journal_line NO FORCE ROW LEVEL SECURITY; ALTER TABLE journal_entry NO FORCE ROW LEVEL SECURITY");
      try {
        for (const sql of [
          "UPDATE journal_line SET amount_cents = 1",
          "DELETE FROM journal_line",
          "UPDATE journal_entry SET description = 'changed'",
          "DELETE FROM journal_entry",
          "TRUNCATE journal_entry, journal_line",
        ]) {
          await expect(admin.query(sql), sql).rejects.toThrow(/ledger is immutable/);
        }
      } finally {
        await admin.query("ALTER TABLE journal_line FORCE ROW LEVEL SECURITY; ALTER TABLE journal_entry FORCE ROW LEVEL SECURITY");
      }
    });
    expect(await linesOf(rentEntry)).toHaveLength(2);
  });

  it("rejects adding lines to a committed entry", async () => {
    await expect(
      inA((c) =>
        c.query("INSERT INTO journal_line (tenant_id, entry_id, account_id, amount_cents) VALUES ($1, $2, $3, 500), ($1, $2, $4, -500)", [a.org, rentEntry, bank, receivable])),
    ).rejects.toThrow(/already committed/);
    expect(await linesOf(rentEntry)).toHaveLength(2);
  });
});

describe("reversal", () => {
  it("rejects a reversal that does not mirror the original", async () => {
    await expect(
      inA(async (c) => {
        const id = (await c.query<{ id: string }>(
          "INSERT INTO journal_entry (tenant_id, booking_date, description, reverses_entry_id) VALUES ($1, '2025-04-10', 'Partial reversal', $2) RETURNING id",
          [a.org, rentEntry],
        )).rows[0]!.id;
        await c.query("INSERT INTO journal_line (tenant_id, entry_id, account_id, amount_cents, property_id) VALUES ($1, $2, $3, -50000, $5), ($1, $2, $4, 50000, $5)", [a.org, id, receivable, rentIncome, a.property]);
      }),
    ).rejects.toThrow(/does not mirror/);
  });

  it("posts the mirrored entry so that the accounts net to zero", async () => {
    const reversal = await inA((c) => reverseJournalEntry(c, a.org, rentEntry, { bookingDate: "2025-04-10", description: "Reversal: rent charge April" }));
    expect(await linesOf(reversal)).toEqual([
      { account_id: receivable, amount_cents: "-95000" },
      { account_id: rentIncome, amount_cents: "95000" },
    ]);
    const balances = await inA(async (c) => (await c.query("SELECT sum(amount_cents)::text AS balance FROM journal_line GROUP BY account_id")).rows);
    expect(balances).toEqual([{ balance: "0" }, { balance: "0" }]);
  });

  it("rejects reversing the same entry twice", async () => {
    await expect(
      inA((c) => reverseJournalEntry(c, a.org, rentEntry, { bookingDate: "2025-04-11", description: "Second reversal" })),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("tenant isolation", () => {
  it("hides accounts and entries from other tenants", async () => {
    const rows = await withTenant(pool, b.org, async (c) => ({
      accounts: (await c.query("SELECT code FROM account")).rows,
      entries: (await c.query("SELECT 1 FROM journal_entry")).rowCount,
      lines: (await c.query("SELECT 1 FROM journal_line")).rowCount,
    }));
    expect(rows).toEqual({ accounts: [{ code: "1000" }], entries: 0, lines: 0 });
  });

  it("rejects reversing another tenant's entry", async () => {
    await expect(
      withTenant(pool, b.org, (c) => reverseJournalEntry(c, b.org, rentEntry, { bookingDate: "2025-04-12", description: "Foreign reversal" })),
    ).rejects.toThrow(/foreign key/);
  });

  it("allows the same account code in different tenants but not twice in one", async () => {
    await expect(createAccount(a.org, "1000", "Second bank", "asset")).rejects.toThrow(/duplicate key/);
  });
});
