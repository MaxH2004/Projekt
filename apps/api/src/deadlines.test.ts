import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

let api: TestApp;
let anna: string;
const password = "a long enough password";
const ok = async (cookie: string, method: string, path: string, body?: unknown) => {
  const res = await api.request(method, path, { cookie, body });
  const text = await res.text();
  expect(res.status, `${method} ${path}: ${text}`).toBeLessThan(300);
  return text ? JSON.parse(text) : undefined;
};

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
});
afterAll(() => api.close());

describe("deadlines", () => {
  it("list missing settlements, ending tenancies and future rent changes", async () => {
    const property = await ok(anna, "POST", "/properties", { name: "P" });
    const building = await ok(anna, "POST", `/properties/${property.id}/buildings`, { street: "S", postalCode: "1", city: "C" });
    const unit = await ok(anna, "POST", `/buildings/${building.id}/units`, { label: "U" });
    const person = await ok(anna, "POST", "/persons", { kind: "natural", familyName: "Sample" });
    const tenancy = await ok(anna, "POST", "/tenancies", { unitId: unit.id, startDate: "2024-07-01", endDate: "2026-12-31", personIds: [person.id], baseRentCents: 50000 });
    await ok(anna, "PUT", `/tenancies/${tenancy.id}/rent`, { kind: "base_rent", amountCents: 52000, validFrom: "2026-10-01" });

    // Seen from 18 November 2026: 2024 and 2025 are not settled; the deadlines are
    // twelve months after each year. The tenancy ends on 31 December 2026; the raise
    // from 1 October is already in the past.
    expect(await ok(anna, "GET", "/deadlines?today=2026-11-18")).toEqual([
      { kind: "settlement_due", date: "2025-12-31", propertyId: property.id, year: 2024 },
      { kind: "settlement_due", date: "2026-12-31", propertyId: property.id, year: 2025 },
      { kind: "tenancy_end", date: "2026-12-31", tenancyId: tenancy.id },
    ]);
    // Seen from 1 September 2026, the raise is ahead.
    expect((await ok(anna, "GET", "/deadlines?today=2026-09-01")).filter((d: { kind: string }) => d.kind === "rent_change")).toEqual([
      { kind: "rent_change", date: "2026-10-01", tenancyId: tenancy.id, component: "base_rent", amountCents: 52000 },
    ]);
  });
});
