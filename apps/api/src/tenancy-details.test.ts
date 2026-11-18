import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

let api: TestApp;
let anna: string;
let ben: string;
let unit: string;
let person: string;
let property: string;

const password = "a long enough password";
const call = async (cookie: string, method: string, path: string, body?: unknown) => {
  const res = await api.request(method, path, { cookie, body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};
const ok = async (cookie: string, method: string, path: string, body?: unknown) => {
  const res = await call(cookie, method, path, body);
  expect(res.status, `${method} ${path}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
  return res.body;
};
const tenancyOn = async (id: string, day: string) => (await ok(anna, "GET", `/tenancies?on=${day}`)).find((t: { id: string }) => t.id === id);

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));
  property = (await ok(anna, "POST", "/properties", { name: "P" })).id;
  const building = await ok(anna, "POST", `/properties/${property}/buildings`, { street: "S 1", postalCode: "1", city: "C" });
  unit = (await ok(anna, "POST", `/buildings/${building.id}/units`, { label: "U", area: { areaCentiSqm: 5000, validFrom: "2020-01-01" } })).id;
  person = (await ok(anna, "POST", "/persons", { kind: "natural", familyName: "Sample" })).id;
});

afterAll(() => api.close());

describe("deposit and occupants", () => {
  it("are recorded on the tenancy, occupants over time", async () => {
    const t = await ok(anna, "POST", "/tenancies", { unitId: unit, startDate: "2025-01-01", personIds: [person], baseRentCents: 50000 });
    expect(t).toMatchObject({ depositCents: null, depositHeld: null, occupants: null });
    expect(await ok(anna, "PUT", `/tenancies/${t.id}/deposit`, { depositCents: 150000, depositHeld: "Savings account" })).toMatchObject({ depositCents: 150000, depositHeld: "Savings account" });

    await ok(anna, "PUT", `/tenancies/${t.id}/occupants`, { persons: 2, validFrom: "2025-01-01" });
    await ok(anna, "PUT", `/tenancies/${t.id}/occupants`, { persons: 3, validFrom: "2026-04-01" });
    expect((await tenancyOn(t.id, "2026-03-31")).occupants).toBe(2);
    expect((await tenancyOn(t.id, "2026-04-01")).occupants).toBe(3);
    expect((await call(anna, "PUT", `/tenancies/${t.id}/occupants`, { persons: 1, validFrom: "2024-12-31" })).body).toEqual({ code: "validation_failed", fields: ["validFrom"] });
    expect((await call(ben, "PUT", `/tenancies/${t.id}/deposit`, { depositCents: 1 })).status).toBe(404);

    // The settlement prefills persons with the occupants at the start of the period.
    await ok(anna, "POST", "/expenses", { paidOn: "2026-02-01", paidFrom: "bank", lines: [{ accountCode: "640000", propertyId: property, amountCents: 1000, operatingCostCategory: "insurance" }] });
    const draft = await ok(anna, "GET", `/settlements/draft?propertyId=${property}&from=2026-01-01&to=2026-12-31`);
    expect(draft.tenancies[0].tenantCount).toBe(2);
  });

  it("are cut off when the tenancy ends, with the rent", async () => {
    const [t] = await ok(anna, "GET", "/tenancies?on=2026-01-01");
    await ok(anna, "PUT", `/tenancies/${t.id}/rent`, { kind: "base_rent", amountCents: 55000, validFrom: "2026-09-01" });
    await ok(anna, "POST", `/tenancies/${t.id}/end`, { endDate: "2026-06-30" });
    const rows = await api.sql<{ tbl: string; valid: string }>(
      `SELECT 'rent' AS tbl, valid::text FROM rent_component WHERE tenancy_id = $1
       UNION ALL SELECT 'occupants', valid::text FROM tenancy_occupants WHERE tenancy_id = $1 ORDER BY 1, 2`,
      [t.id],
    );
    // The raise from September is gone; everything ends with the last day, 30 June 2026.
    expect(rows).toEqual([
      { tbl: "occupants", valid: "[2025-01-01,2026-04-01)" },
      { tbl: "occupants", valid: "[2026-04-01,2026-07-01)" },
      { tbl: "rent", valid: "[2025-01-01,2026-07-01)" },
    ]);
  });
});

describe("deleting a tenancy", () => {
  it("works for one entered by mistake, not once charges exist", async () => {
    const mistake = await ok(anna, "POST", "/tenancies", { unitId: unit, startDate: "2027-01-01", personIds: [person], baseRentCents: 1 });
    await ok(anna, "PUT", `/tenancies/${mistake.id}/occupants`, { persons: 1, validFrom: "2027-01-01" });
    expect((await call(ben, "DELETE", `/tenancies/${mistake.id}`)).status).toBe(404);
    expect((await call(anna, "DELETE", `/tenancies/${mistake.id}`)).status).toBe(204);
    expect(await tenancyOn(mistake.id, "2027-01-01")).toBeUndefined();

    const [used] = await ok(anna, "GET", "/tenancies?on=2026-01-01");
    await ok(anna, "POST", "/charges/generate", { month: "2026-01" });
    expect(await call(anna, "DELETE", `/tenancies/${used.id}`)).toEqual({ status: 409, body: { code: "conflict" } });
  });
});

describe("meter readings", () => {
  it("must lie between the readings before and after", async () => {
    const meter = await ok(anna, "POST", "/meters", { unitId: unit, kind: "water_cold", measure: "m3", serialNumber: "W-1" });
    await ok(anna, "POST", `/meters/${meter.id}/readings`, { readingDate: "2026-01-01", value: "100.5" });
    await ok(anna, "POST", `/meters/${meter.id}/readings`, { readingDate: "2026-12-31", value: "180" });
    const lower = await call(anna, "POST", `/meters/${meter.id}/readings`, { readingDate: "2026-06-30", value: "99" });
    expect([lower.status, lower.body]).toEqual([422, { code: "reading_not_plausible", fields: ["value"] }]);
    expect((await call(anna, "POST", `/meters/${meter.id}/readings`, { readingDate: "2026-06-30", value: "180.001" })).status).toBe(422);
    expect((await call(anna, "POST", `/meters/${meter.id}/readings`, { readingDate: "2026-06-30", value: "140" })).status).toBe(201);
  });
});
