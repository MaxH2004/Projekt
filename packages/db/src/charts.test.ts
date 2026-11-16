import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedChartOfAccounts, SKR04_RENTAL_SUBSET, withTenant } from "./index.js";
import { resetDatabase, testDatabaseUrl, type SeededTenant } from "./test-support.js";

const pool = new pg.Pool({ connectionString: testDatabaseUrl() });
let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  ({ a, b } = await resetDatabase(pool));
});

afterAll(() => pool.end());

describe("SKR 04 subset", () => {
  it("has unique four-digit codes whose class matches the account type", () => {
    const codes = SKR04_RENTAL_SUBSET.map((acc) => acc.code);
    expect(new Set(codes).size).toBe(codes.length);
    // SKR 04 classes: 0–1 assets, 2 equity, 3 liabilities, 4 income, 5–7 expenses.
    const typeOfClass: Record<string, string> = { "0": "asset", "1": "asset", "2": "equity", "3": "liability", "4": "income", "5": "expense", "6": "expense", "7": "expense" };
    for (const acc of SKR04_RENTAL_SUBSET) {
      expect(acc.code, acc.name).toMatch(/^\d{4}$/);
      expect(acc.type, acc.code).toBe(typeOfClass[acc.code[0]!]);
    }
  });

  it("is created once per tenant and is safe to repeat", async () => {
    const seed = (tenant: string) => withTenant(pool, tenant, (c) => seedChartOfAccounts(c, tenant, SKR04_RENTAL_SUBSET));
    expect(await seed(a.org)).toEqual(SKR04_RENTAL_SUBSET.map((acc) => acc.code).sort());
    expect(await seed(a.org)).toEqual([]);
    expect(await seed(b.org)).toHaveLength(SKR04_RENTAL_SUBSET.length);
    const bank = await withTenant(pool, a.org, (c) => c.query("SELECT name, type FROM account WHERE code = '1800'"));
    expect(bank.rows).toEqual([{ name: "Bank", type: "asset" }]);
  });
});
