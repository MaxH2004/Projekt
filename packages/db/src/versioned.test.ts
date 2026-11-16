import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setValueFrom, withTenant, type VersionedTable } from "./index.js";
import { resetDatabase, testDatabaseUrl, type SeededTenant } from "./test-support.js";

const pool = new pg.Pool({ connectionString: testDatabaseUrl() });
let a: SeededTenant;
let area: VersionedTable;

const set = (value: number, from: string) => withTenant(pool, a.org, (c) => setValueFrom(c, a.org, area, value, from));
const history = async () =>
  (
    await withTenant(pool, a.org, (c) =>
      c.query("SELECT area_centi_sqm AS v, lower(valid)::text AS f, upper(valid)::text AS t FROM unit_area WHERE unit_id = $1 ORDER BY lower(valid)", [a.unit]),
    )
  ).rows;

beforeAll(async () => {
  ({ a } = await resetDatabase(pool));
  area = { table: "unit_area", key: { unit_id: a.unit }, valueColumn: "area_centi_sqm" };
});

afterAll(() => pool.end());

describe("setValueFrom", () => {
  it("starts an open-ended first version", async () => {
    await set(5000, "2020-01-01");
    expect(await history()).toEqual([{ v: 5000, f: "2020-01-01", t: null }]);
  });

  it("cuts the current version off the day the new one starts", async () => {
    await set(5500, "2025-07-01");
    expect(await history()).toEqual([
      { v: 5000, f: "2020-01-01", t: "2025-07-01" },
      { v: 5500, f: "2025-07-01", t: null },
    ]);
  });

  it("replaces the value when a version starts on that day", async () => {
    await set(5600, "2025-07-01");
    expect(await history()).toHaveLength(2);
    expect((await history())[1]).toEqual({ v: 5600, f: "2025-07-01", t: null });
  });

  it("inserts a version in the middle without touching later ones", async () => {
    await set(5200, "2023-01-01");
    expect(await history()).toEqual([
      { v: 5000, f: "2020-01-01", t: "2023-01-01" },
      { v: 5200, f: "2023-01-01", t: "2025-07-01" },
      { v: 5600, f: "2025-07-01", t: null },
    ]);
  });

  it("puts a version before the first one, ending where that begins", async () => {
    await set(4800, "2019-01-01");
    expect((await history()).slice(0, 2)).toEqual([
      { v: 4800, f: "2019-01-01", t: "2020-01-01" },
      { v: 5000, f: "2020-01-01", t: "2023-01-01" },
    ]);
  });
});
