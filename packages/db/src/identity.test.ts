import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enterTenant, withIdentity, withTenant } from "./index.js";
import { resetDatabase, testDatabaseUrl, type SeededTenant } from "./test-support.js";

const pool = new pg.Pool({ connectionString: testDatabaseUrl() });
let a: SeededTenant;

beforeAll(async () => {
  ({ a } = await resetDatabase(pool));
});

afterAll(() => pool.end());

describe("identity role", () => {
  it("creates an organization with its first user and can then enter the tenant", async () => {
    const org = randomUUID();
    const propertyCount = await withIdentity(pool, async (c) => {
      await c.query("INSERT INTO organization (id, name) VALUES ($1, 'New landlord')", [org]);
      const user = (await c.query<{ id: string }>("INSERT INTO app_user (email, password_hash) VALUES ('new@example.com', 'x') RETURNING id")).rows[0]!.id;
      await c.query("INSERT INTO membership (user_id, tenant_id) VALUES ($1, $2)", [user, org]);
      await enterTenant(c, org);
      await c.query("INSERT INTO property (tenant_id, name) VALUES ($1, 'First property')", [org]);
      return (await c.query("SELECT 1 FROM property")).rowCount;
    });
    expect(propertyCount).toBe(1);
  });

  it("cannot read or write tenant data", async () => {
    await expect(withIdentity(pool, (c) => c.query("SELECT 1 FROM property"))).rejects.toThrow(/permission denied/);
    await expect(withIdentity(pool, (c) => c.query("SELECT 1 FROM journal_line"))).rejects.toThrow(/permission denied/);
    await expect(withIdentity(pool, (c) => c.query("UPDATE organization SET name = 'x'"))).rejects.toThrow(/permission denied/);
  });

  it("stores e-mail addresses only in normalized form and only once", async () => {
    const insert = (email: string) => withIdentity(pool, (c) => c.query("INSERT INTO app_user (email, password_hash) VALUES ($1, 'x')", [email]));
    await expect(insert("Upper@Example.com")).rejects.toThrow(/check constraint/);
    await expect(insert("no-at-sign")).rejects.toThrow(/check constraint/);
    await expect(insert("new@example.com")).rejects.toThrow(/duplicate key/);
  });
});

describe("application role", () => {
  it("has no access to users, memberships and sessions", async () => {
    for (const table of ["app_user", "membership", "session"]) {
      await expect(withTenant(pool, a.org, (c) => c.query(`SELECT 1 FROM ${table}`)), table).rejects.toThrow(/permission denied/);
    }
  });
});
