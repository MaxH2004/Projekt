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
const created = async (cookie: string, path: string, body: unknown) => {
  const res = await call(cookie, "POST", path, body);
  expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body;
};

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));
});

afterAll(() => api.close());

describe("access", () => {
  it("requires a session on every master data route", async () => {
    for (const [method, path] of [
      ["GET", "/properties"],
      ["POST", "/properties"],
      ["GET", "/persons"],
      ["GET", "/tenancies"],
      ["GET", "/meters"],
    ] as const) {
      const res = await api.request(method, path, { body: method === "POST" ? { name: "x" } : undefined });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("properties, buildings, units", () => {
  let property: { id: string };
  let building: { id: string };
  let unit: { id: string };

  it("creates the chain property, building, unit", async () => {
    property = await created(anna, "/properties", { name: "  Linden Street 5 " });
    expect(property).toEqual({ id: property.id, name: "Linden Street 5", ownershipForm: "rental" });
    building = await created(anna, `/properties/${property.id}/buildings`, { street: "Linden Street 5", postalCode: "12345", city: "Sampletown" });
    unit = await created(anna, `/buildings/${building.id}/units`, { label: "Ground floor left", area: { areaCentiSqm: 5437, validFrom: "2000-01-01" } });
    expect(unit).toEqual({ id: unit.id, buildingId: building.id, label: "Ground floor left", areaCentiSqm: 5437 });

    expect((await call(anna, "GET", "/properties")).body).toEqual([property]);
    expect((await call(anna, "GET", `/properties/${property.id}/buildings`)).body).toHaveLength(1);
    expect((await call(anna, "GET", `/buildings/${building.id}/units`)).body).toEqual([unit]);
  });

  it("renames", async () => {
    expect((await call(anna, "PATCH", `/properties/${property.id}`, { name: "Linden Street 5–7" })).body.name).toBe("Linden Street 5–7");
    expect((await call(anna, "PATCH", `/units/${unit.id}`, { label: "GF left" })).body).toMatchObject({ label: "GF left", areaCentiSqm: 5437 });
  });

  it("validates input", async () => {
    expect((await call(anna, "POST", "/properties", { name: " " })).body).toEqual({ code: "validation_failed", fields: ["name"] });
    const res = await call(anna, "POST", `/buildings/${building.id}/units`, { label: "x", area: { areaCentiSqm: 54.37, validFrom: "2025-02-30" } });
    expect(res.body).toEqual({ code: "validation_failed", fields: ["area.areaCentiSqm", "area.validFrom"] });
  });

  it("rejects a duplicate unit label within a building", async () => {
    const res = await call(anna, "POST", `/buildings/${building.id}/units`, { label: "GF left" });
    expect([res.status, res.body.code]).toEqual([409, "conflict"]);
  });

  it("keeps an area history and reports the area valid today", async () => {
    const res = await call(anna, "PUT", `/units/${unit.id}/area`, { areaCentiSqm: 5612, validFrom: "2024-07-01" });
    expect(res.body).toEqual([
      { areaCentiSqm: 5437, validFrom: "2000-01-01", validTo: "2024-06-30" },
      { areaCentiSqm: 5612, validFrom: "2024-07-01", validTo: null },
    ]);
    expect((await call(anna, "GET", `/buildings/${building.id}/units`)).body[0].areaCentiSqm).toBe(5612);
    expect((await call(anna, "GET", `/units/${unit.id}/areas`)).body).toHaveLength(2);
  });

  it("hides everything from another organization", async () => {
    expect((await call(ben, "GET", "/properties")).body).toEqual([]);
    for (const [method, path, body] of [
      ["GET", `/properties/${property.id}/buildings`, undefined],
      ["PATCH", `/properties/${property.id}`, { name: "hijacked" }],
      ["DELETE", `/properties/${property.id}`, undefined],
      ["POST", `/properties/${property.id}/buildings`, { street: "x", postalCode: "1", city: "x" }],
      ["GET", `/buildings/${building.id}/units`, undefined],
      ["POST", `/buildings/${building.id}/units`, { label: "x" }],
      ["PATCH", `/units/${unit.id}`, { label: "hijacked" }],
      ["PUT", `/units/${unit.id}/area`, { areaCentiSqm: 1, validFrom: "2025-01-01" }],
      ["DELETE", `/units/${unit.id}`, undefined],
    ] as const) {
      const res = await call(ben, method, path, body);
      expect([res.status, res.body?.code], `${method} ${path}`).toEqual([404, "not_found"]);
    }
    expect((await call(anna, "GET", "/properties")).body[0].name).toBe("Linden Street 5–7");
    expect((await call(anna, "GET", `/units/${unit.id}/areas`)).body).toHaveLength(2);
  });

  it("answers malformed ids with 404, not 500", async () => {
    expect((await call(anna, "GET", "/properties/not-a-uuid/buildings")).status).toBe(404);
    expect((await call(anna, "DELETE", "/units/123")).status).toBe(404);
  });

  it("refuses to delete what is still in use and deletes bottom-up", async () => {
    expect((await call(anna, "DELETE", `/properties/${property.id}`)).body).toEqual({ code: "conflict" });
    expect((await call(anna, "DELETE", `/buildings/${building.id}`)).body).toEqual({ code: "conflict" });
    expect((await call(anna, "DELETE", `/units/${unit.id}`)).status).toBe(204);
    expect((await call(anna, "DELETE", `/buildings/${building.id}`)).status).toBe(204);
    expect((await call(anna, "DELETE", `/properties/${property.id}`)).status).toBe(204);
    expect((await call(anna, "DELETE", `/properties/${property.id}`)).status).toBe(404);
    expect(await api.sql("SELECT 1 FROM unit_area")).toHaveLength(0);
  });
});

describe("persons and tenancies", () => {
  let unit: { id: string };
  let erika: { id: string };
  let company: { id: string };
  let tenancy: { id: string };

  beforeAll(async () => {
    const property = await created(anna, "/properties", { name: "Oak Road 1" });
    const building = await created(anna, `/properties/${property.id}/buildings`, { street: "Oak Road 1", postalCode: "12345", city: "Sampletown" });
    unit = await created(anna, `/buildings/${building.id}/units`, { label: "1st floor" });
  });

  it("creates natural and legal persons", async () => {
    erika = await created(anna, "/persons", { kind: "natural", givenName: "Erika", familyName: "Sample", email: "Erika@Example.com" });
    expect(erika).toMatchObject({ kind: "natural", givenName: "Erika", familyName: "Sample", companyName: null, email: "erika@example.com", phone: null });
    company = await created(anna, "/persons", { kind: "legal", companyName: "Sample Ltd" });
    expect((await call(anna, "POST", "/persons", { kind: "natural", givenName: "No family name" })).body.fields).toEqual(["familyName"]);
    expect((await call(anna, "GET", "/persons")).body.map((p: { id: string }) => p.id).sort()).toEqual([erika.id, company.id].sort());
    expect((await call(ben, "GET", "/persons")).body).toEqual([]);
  });

  it("creates a tenancy with parties and rent from the first day", async () => {
    tenancy = await created(anna, "/tenancies", {
      unitId: unit.id,
      startDate: "2024-04-01",
      personIds: [erika.id, company.id],
      baseRentCents: 80_000,
      operatingCostAdvanceCents: 15_000,
    });
    expect(tenancy).toEqual({
      id: tenancy.id,
      unitId: unit.id,
      startDate: "2024-04-01",
      endDate: null,
      rentType: "fixed",
      personIds: [erika.id, company.id].sort(),
      rent: { base_rent: 80_000, operating_cost_advance: 15_000 },
      depositCents: null,
      depositHeld: null,
      occupants: null,
    });
  });

  it("rejects an overlapping tenancy, unknown persons and foreign units", async () => {
    const base = { unitId: unit.id, startDate: "2025-01-01", personIds: [erika.id], baseRentCents: 1 };
    expect((await call(anna, "POST", "/tenancies", base)).body).toEqual({ code: "conflict" });
    const unknownPerson = await call(anna, "POST", "/tenancies", { ...base, startDate: "2020-01-01", endDate: "2020-12-31", personIds: ["00000000-0000-4000-8000-000000000000"] });
    expect(unknownPerson.body).toEqual({ code: "not_found" });
    expect((await call(ben, "POST", "/tenancies", { ...base, personIds: [erika.id] })).body).toEqual({ code: "not_found" });
    expect((await call(anna, "POST", "/tenancies", { ...base, endDate: "2024-12-31" })).body).toEqual({ code: "validation_failed", fields: ["endDate"] });
    // Nothing of the failed attempts was kept.
    expect((await call(anna, "GET", `/tenancies?unitId=${unit.id}`)).body).toHaveLength(1);
  });

  it("changes the rent from a date on and still reports the earlier amount", async () => {
    const changed = await call(anna, "PUT", `/tenancies/${tenancy.id}/rent`, { kind: "base_rent", amountCents: 84_000, validFrom: "2025-01-01" });
    expect(changed.body.rent).toEqual({ base_rent: 84_000, operating_cost_advance: 15_000 });
    const before = await call(anna, "GET", `/tenancies?unitId=${unit.id}&on=2024-12-31`);
    expect(before.body[0].rent.base_rent).toBe(80_000);
    const after = await call(anna, "GET", `/tenancies?unitId=${unit.id}&on=2025-01-01`);
    expect(after.body[0].rent.base_rent).toBe(84_000);
  });

  it("adds a component later and refuses changes outside the tenancy", async () => {
    const heating = await call(anna, "PUT", `/tenancies/${tenancy.id}/rent`, { kind: "heating_cost_advance", amountCents: 9_000, validFrom: "2025-03-01" });
    expect(heating.body.rent.heating_cost_advance).toBe(9_000);
    const tooEarly = await call(anna, "PUT", `/tenancies/${tenancy.id}/rent`, { kind: "base_rent", amountCents: 1, validFrom: "2024-03-31" });
    expect(tooEarly.body).toEqual({ code: "validation_failed", fields: ["validFrom"] });
    expect((await call(ben, "PUT", `/tenancies/${tenancy.id}/rent`, { kind: "base_rent", amountCents: 1, validFrom: "2025-01-01" })).status).toBe(404);
  });

  it("ends a tenancy and then allows the next one", async () => {
    expect((await call(anna, "POST", `/tenancies/${tenancy.id}/end`, { endDate: "2024-03-31" })).body).toEqual({ code: "validation_failed", fields: ["endDate"] });
    const ended = await call(anna, "POST", `/tenancies/${tenancy.id}/end`, { endDate: "2025-06-30" });
    expect([ended.status, ended.body.endDate]).toEqual([200, "2025-06-30"]);
    const next = await created(anna, "/tenancies", { unitId: unit.id, startDate: "2025-07-01", personIds: [company.id], baseRentCents: 90_000 });
    expect(next.rent).toEqual({ base_rent: 90_000 });
    expect((await call(anna, "GET", `/tenancies?unitId=${unit.id}`)).body.map((t: { startDate: string }) => t.startDate)).toEqual(["2024-04-01", "2025-07-01"]);
  });

  it("keeps persons that are party to a tenancy", async () => {
    expect((await call(anna, "DELETE", `/persons/${erika.id}`)).body).toEqual({ code: "conflict" });
    expect((await call(ben, "DELETE", `/persons/${erika.id}`)).status).toBe(404);
    const renamed = await call(anna, "PUT", `/persons/${erika.id}`, { kind: "natural", givenName: "Erika", familyName: "Sample-Smith" });
    expect(renamed.body).toMatchObject({ familyName: "Sample-Smith", email: null });
  });
});

describe("meters", () => {
  let unit: { id: string };
  let building: { id: string };
  let meter: { id: string };

  beforeAll(async () => {
    const property = await created(anna, "/properties", { name: "Elm Lane 3" });
    building = await created(anna, `/properties/${property.id}/buildings`, { street: "Elm Lane 3", postalCode: "12345", city: "Sampletown" });
    unit = await created(anna, `/buildings/${building.id}/units`, { label: "Attic" });
  });

  it("belongs to exactly one unit or building", async () => {
    meter = await created(anna, "/meters", { unitId: unit.id, kind: "water_cold", measure: "m3", serialNumber: "W-123" });
    expect(meter).toEqual({ id: meter.id, unitId: unit.id, buildingId: null, kind: "water_cold", measure: "m3", serialNumber: "W-123" });
    await created(anna, "/meters", { buildingId: building.id, kind: "gas", measure: "kWh", serialNumber: "G-9" });
    const both = await call(anna, "POST", "/meters", { unitId: unit.id, buildingId: building.id, kind: "gas", measure: "kWh", serialNumber: "x" });
    const neither = await call(anna, "POST", "/meters", { kind: "gas", measure: "kWh", serialNumber: "x" });
    expect([both.body.code, neither.body.code]).toEqual(["validation_failed", "validation_failed"]);
    expect((await call(anna, "GET", `/meters?unitId=${unit.id}`)).body).toEqual([meter]);
    expect((await call(anna, "GET", "/meters")).body).toHaveLength(2);
    expect((await call(ben, "POST", "/meters", { unitId: unit.id, kind: "gas", measure: "kWh", serialNumber: "x" })).body).toEqual({ code: "not_found" });
  });

  it("stores readings as exact decimals, one per day", async () => {
    const first = await created(anna, `/meters/${meter.id}/readings`, { readingDate: "2024-12-31", value: "1234.5" });
    expect(first).toMatchObject({ readingDate: "2024-12-31", value: "1234.5" });
    await created(anna, `/meters/${meter.id}/readings`, { readingDate: "2025-12-31", value: "1300.125" });
    expect((await call(anna, "POST", `/meters/${meter.id}/readings`, { readingDate: "2025-12-31", value: "1301" })).body).toEqual({ code: "conflict" });
    for (const value of ["-1", "1,5", "1.2345", 1234.5]) {
      expect((await call(anna, "POST", `/meters/${meter.id}/readings`, { readingDate: "2026-01-01", value })).body.fields, String(value)).toEqual(["value"]);
    }
    expect((await call(anna, "GET", `/meters/${meter.id}/readings`)).body.map((r: { value: string }) => r.value)).toEqual(["1234.5", "1300.125"]);
    expect((await call(ben, "GET", `/meters/${meter.id}/readings`)).status).toBe(404);
    // Also for a day that already has a reading: no hint that the meter exists.
    expect((await call(ben, "POST", `/meters/${meter.id}/readings`, { readingDate: "2025-12-31", value: "1" })).status).toBe(404);
  });

  it("deletes a meter together with its readings", async () => {
    expect((await call(ben, "DELETE", `/meters/${meter.id}`)).status).toBe(404);
    expect((await call(anna, "DELETE", `/meters/${meter.id}`)).status).toBe(204);
    expect(await api.sql("SELECT 1 FROM meter_reading")).toHaveLength(0);
  });
});
