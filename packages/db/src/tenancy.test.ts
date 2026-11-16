import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "./index.js";
import { resetDatabase, testDatabaseUrl, type SeededTenant } from "./test-support.js";

const pool = new pg.Pool({ connectionString: testDatabaseUrl() });
let a: SeededTenant;
let b: SeededTenant;
let tenancyId: string;

const inA = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(pool, a.org, fn);
const insertTenancy = (unit: string, term: string) =>
  inA(async (c) => (await c.query<{ id: string }>("INSERT INTO tenancy (tenant_id, unit_id, term) VALUES ($1, $2, $3) RETURNING id", [a.org, unit, term])).rows[0]!.id);
const insertRent = (kind: string, cents: number, valid: string) =>
  inA((c) => c.query("INSERT INTO rent_component (tenant_id, tenancy_id, kind, amount_cents, valid) VALUES ($1, $2, $3, $4, $5)", [a.org, tenancyId, kind, cents, valid]));

beforeAll(async () => {
  ({ a, b } = await resetDatabase(pool));
});

afterAll(() => pool.end());

describe("persons", () => {
  it("accepts natural and legal persons", async () => {
    await inA((c) => c.query("INSERT INTO person (tenant_id, kind, given_name, family_name) VALUES ($1, 'natural', 'Erika', 'Sample')", [a.org]));
    await inA((c) => c.query("INSERT INTO person (tenant_id, kind, company_name) VALUES ($1, 'legal', 'Sample Ltd')", [a.org]));
    expect((await inA((c) => c.query("SELECT 1 FROM person"))).rowCount).toBe(2);
  });

  it("rejects a natural person without family name and a legal person without company name", async () => {
    await expect(inA((c) => c.query("INSERT INTO person (tenant_id, kind, given_name) VALUES ($1, 'natural', 'Erika')", [a.org]))).rejects.toThrow(/check constraint/);
    await expect(inA((c) => c.query("INSERT INTO person (tenant_id, kind, family_name) VALUES ($1, 'legal', 'Sample')", [a.org]))).rejects.toThrow(/check constraint/);
  });
});

describe("tenancies", () => {
  it("allows a new tenancy on the day after the previous one ends", async () => {
    await insertTenancy(a.unit, "[2020-01-01,2025-04-01)");
    tenancyId = await insertTenancy(a.unit, "[2025-04-01,)");
    const on = (day: string) => inA((c) => c.query("SELECT id FROM tenancy WHERE unit_id = $1 AND term @> $2::date", [a.unit, day]));
    expect((await on("2025-03-31")).rows[0].id).not.toBe(tenancyId);
    expect((await on("2025-04-01")).rows).toEqual([{ id: tenancyId }]);
  });

  it("rejects a second tenancy for the same unit on the same day", async () => {
    await expect(insertTenancy(a.unit, "[2025-03-31,2025-04-02)")).rejects.toThrow(/exclusion constraint/);
    await expect(insertTenancy(a.unit, "[2030-01-01,)")).rejects.toThrow(/exclusion constraint/);
  });

  it("rejects a tenancy without a start date", async () => {
    await expect(insertTenancy(a.unit, "(,2019-01-01)")).rejects.toThrow(/check constraint/);
  });

  it("rejects a tenancy for another tenant's unit", async () => {
    await expect(insertTenancy(b.unit, "[2025-01-01,)")).rejects.toThrow(/foreign key/);
  });

  it("links persons to a tenancy once each", async () => {
    const person = (await inA((c) => c.query<{ id: string }>("SELECT id FROM person WHERE kind = 'natural'"))).rows[0]!.id;
    const link = () => inA((c) => c.query("INSERT INTO tenancy_party (tenant_id, tenancy_id, person_id) VALUES ($1, $2, $3)", [a.org, tenancyId, person]));
    await link();
    await expect(link()).rejects.toThrow(/duplicate key/);
  });
});

describe("rent components", () => {
  it("returns the amount valid on a given day after a rent change", async () => {
    await insertRent("base_rent", 80_000, "[2025-04-01,2026-01-01)");
    await insertRent("base_rent", 84_000, "[2026-01-01,)");
    await insertRent("operating_cost_advance", 15_000, "[2025-04-01,)");
    const on = (day: string) =>
      inA((c) => c.query("SELECT kind, amount_cents FROM rent_component WHERE tenancy_id = $1 AND valid @> $2::date ORDER BY kind", [tenancyId, day]));
    expect((await on("2025-12-31")).rows).toEqual([
      { kind: "base_rent", amount_cents: "80000" },
      { kind: "operating_cost_advance", amount_cents: "15000" },
    ]);
    expect((await on("2026-01-01")).rows[0]).toEqual({ kind: "base_rent", amount_cents: "84000" });
  });

  it("rejects two amounts for the same component on the same day", async () => {
    await expect(insertRent("base_rent", 90_000, "[2025-12-01,2026-02-01)")).rejects.toThrow(/exclusion constraint/);
  });

  it("rejects negative amounts and unknown components", async () => {
    await expect(insertRent("heating_cost_advance", -1, "[2025-04-01,)")).rejects.toThrow(/check constraint/);
    await expect(insertRent("parking", 5_000, "[2025-04-01,)")).rejects.toThrow(/check constraint/);
  });

  it("is invisible to other tenants", async () => {
    const rows = await withTenant(pool, b.org, (c) => c.query("SELECT 1 FROM rent_component UNION ALL SELECT 1 FROM tenancy UNION ALL SELECT 1 FROM person"));
    expect(rows.rowCount).toBe(0);
  });
});
