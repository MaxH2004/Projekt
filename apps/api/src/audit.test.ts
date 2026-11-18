import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

let api: TestApp;
let anna: string;
let ben: string;
const password = "a long enough password";
const call = async (cookie: string, method: string, path: string, body?: unknown) => {
  const res = await api.request(method, path, { cookie, body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));
});

afterAll(() => api.close());

describe("audit log", () => {
  it("records financial changes with the user who made them", async () => {
    const me = (await call(anna, "GET", "/auth/me")).body;
    const property = (await call(anna, "POST", "/properties", { name: "P" })).body;
    const expense = (
      await call(anna, "POST", "/expenses", { paidOn: "2026-03-01", paidFrom: "bank", lines: [{ accountCode: "640000", propertyId: property.id, amountCents: 1000 }] })
    ).body;
    await call(anna, "POST", `/expenses/${expense.id}/reverse`, { bookingDate: "2026-03-02" });

    const log = (await call(anna, "GET", "/organization/audit-log?limit=10")).body as { table: string; action: string; userId: string; rowId: string; oldRow: unknown; newRow: { reversal_entry_id?: string } }[];
    // Newest first: the reversal updates the expense after posting its reversing entry.
    expect(log.slice(0, 3).map((e) => [e.table, e.action])).toEqual([
      ["expense", "update"],
      ["journal_entry", "insert"],
      ["expense_line", "insert"],
    ]);
    expect(log[0]!.rowId).toBe(expense.id);
    expect(log[0]!.oldRow).toMatchObject({ reversal_entry_id: null });
    expect(log[0]!.newRow.reversal_entry_id).toEqual(expect.any(String));
    // Everything after registration was done by Anna; the chart created at registration has no user.
    const own = log.filter((e) => e.table !== "account");
    // Expense, its line, its journal entry, the reversing entry, the expense marked as reversed.
    expect(own.map((e) => `${e.table}:${e.action}`).sort()).toEqual(["expense:insert", "expense:update", "expense_line:insert", "journal_entry:insert", "journal_entry:insert"]);
    expect(own.every((e) => e.userId === me.userId)).toBe(true);
  });

  it("shows each organization only its own entries and pages backwards", async () => {
    const benLog = (await call(ben, "GET", "/organization/audit-log")).body as { table: string; userId: string | null }[];
    // Ben's chart of accounts was created at registration, before any user acted.
    expect(benLog.every((e) => e.table === "account" && e.userId === null)).toBe(true);
    const page1 = (await call(anna, "GET", "/organization/audit-log?limit=2")).body as { id: number }[];
    const page2 = (await call(anna, "GET", `/organization/audit-log?limit=2&before=${page1[1]!.id}`)).body as { id: number }[];
    expect(page2[0]!.id).toBeLessThan(page1[1]!.id);
  });

  it("cannot be written, changed or deleted by the application role", async () => {
    const [row] = await api.sql<{ tenant_id: string; id: string }>("SELECT tenant_id, id::text FROM audit_log LIMIT 1");
    for (const [sql, expected] of [
      ["INSERT INTO audit_log (tenant_id, table_name, action) VALUES ($1, 'x', 'insert')", "42501"],
      ["UPDATE audit_log SET table_name = 'x' WHERE tenant_id = $1", "42501"],
      ["DELETE FROM audit_log WHERE tenant_id = $1", "42501"],
    ] as const) {
      await api.sql("BEGIN");
      try {
        await api.sql("SET LOCAL ROLE hv_app");
        await api.sql("SELECT set_config('app.tenant_id', $1, true)", [row!.tenant_id]);
        await expect(api.sql(sql, [row!.tenant_id]), sql).rejects.toMatchObject({ code: expected });
      } finally {
        await api.sql("ROLLBACK");
      }
    }
    // Not even the owner may change it.
    await expect(api.sql("DELETE FROM audit_log WHERE id = $1", [row!.id])).rejects.toThrow(/append-only/);
  });
});
