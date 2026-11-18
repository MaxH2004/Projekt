import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

// The case of apps/api/src/modules/settlement/assemble.test.ts, built through
// the API: costs from expenses, advances from paid charges.

let api: TestApp;
let anna: string;
let ben: string;
let property: string;
let unitA: string;
let unitB: string;
let t1: string;
let t2: string;

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
const expense = (paidOn: string, accountCode: string, amountCents: number, operatingCostCategory: string | null) =>
  ok(anna, "POST", "/expenses", { paidOn, paidFrom: "bank", lines: [{ accountCode, propertyId: property, amountCents, operatingCostCategory }] });

const period = { from: "2026-01-01", to: "2026-12-31" };
const keys = { insurance: { key: "area" }, street_cleaning_waste: { key: "units" }, water_supply: { key: "persons" } };

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));

  property = (await ok(anna, "POST", "/properties", { name: "Linden Street 5" })).id;
  const building = await ok(anna, "POST", `/properties/${property}/buildings`, { street: "Linden Street 5", postalCode: "12345", city: "Sampletown" });
  unitA = (await ok(anna, "POST", `/buildings/${building.id}/units`, { label: "A", area: { areaCentiSqm: 6000, validFrom: "2020-01-01" } })).id;
  unitB = (await ok(anna, "POST", `/buildings/${building.id}/units`, { label: "B", area: { areaCentiSqm: 4000, validFrom: "2020-01-01" } })).id;
  const p1 = await ok(anna, "POST", "/persons", { kind: "natural", familyName: "One" });
  const p2 = await ok(anna, "POST", "/persons", { kind: "natural", familyName: "Two" });
  // T1: 500.00 rent + 100.00 advance all year; T2 from 1 July: 400.00 + 50.00.
  t1 = (await ok(anna, "POST", "/tenancies", { unitId: unitA, startDate: "2025-01-01", personIds: [p1.id], baseRentCents: 50000, operatingCostAdvanceCents: 10000 })).id;
  t2 = (await ok(anna, "POST", "/tenancies", { unitId: unitB, startDate: "2026-07-01", personIds: [p2.id], baseRentCents: 40000, operatingCostAdvanceCents: 5000 })).id;
  for (let m = 1; m <= 12; m++) await ok(anna, "POST", "/charges/generate", { month: `2026-${String(m).padStart(2, "0")}` });
  // Everything paid: advances covered 12 × 100.00 = 1200.00 and 6 × 50.00 = 300.00.
  await ok(anna, "POST", "/payments", { tenancyId: t1, receivedOn: "2026-12-31", amountCents: 720000 });
  await ok(anna, "POST", "/payments", { tenancyId: t2, receivedOn: "2026-12-31", amountCents: 270000 });

  await expense("2026-03-01", "640000", 100000, "insurance");
  await expense("2026-04-01", "685900", 36500, "street_cleaning_waste");
  await expense("2026-05-01", "632800", 50000, "water_supply");
  await expense("2026-11-01", "632800", 23000, "water_supply");
  // Left out: heating, a cost paid in the previous year, one without category, a reversed one.
  await expense("2026-06-01", "632000", 50000, "heating");
  await expense("2025-12-31", "640000", 99900, "insurance");
  await expense("2026-06-01", "645000", 12300, null);
  const reversed = await expense("2026-06-01", "640000", 77700, "insurance");
  await ok(anna, "POST", `/expenses/${reversed.id}/reverse`, { bookingDate: "2026-06-02" });
});

afterAll(() => api.close());

describe("draft", () => {
  it("collects units, tenancies with paid advances and the allocable costs of the period", async () => {
    const draft = await ok(anna, "GET", `/settlements/draft?propertyId=${property}&from=2026-01-01&to=2026-12-31`);
    expect(draft).toEqual({
      propertyId: property,
      ...period,
      periodDays: 365,
      units: [
        { id: unitA, label: "A", areaCentiSqm: 6000 },
        { id: unitB, label: "B", areaCentiSqm: 4000 },
      ],
      tenancies: [
        { id: t1, unitId: unitA, days: 365, tenantCount: 1, advancesPaidCents: 120000 },
        { id: t2, unitId: unitB, days: 184, tenantCount: 1, advancesPaidCents: 30000 },
      ],
      costs: [
        { category: "water_supply", amountCents: 73000, lineCount: 2 },
        { category: "street_cleaning_waste", amountCents: 36500, lineCount: 1 },
        { category: "insurance", amountCents: 100000, lineCount: 1 },
      ],
      excluded: [{ category: "heating", amountCents: 50000 }],
    });
  });

  it("accepts only whole months", async () => {
    const res = await call(anna, "GET", `/settlements/draft?propertyId=${property}&from=2026-01-02&to=2026-12-30`);
    expect(res.body).toEqual({ code: "validation_failed", fields: ["from", "to"] });
  });
});

describe("preview and finalize", () => {
  const config = () => ({ propertyId: property, ...period, keys, personsByTenancy: { [t1]: 2, [t2]: 1 }, vacancyPersons: 1 });

  it("previews the hand-calculated shares and names missing choices", async () => {
    const result = await ok(anna, "POST", "/settlements/preview", config());
    const shares = (id: string) => Object.fromEntries(result.statements.find((s: { tenancyId: string }) => s.tenancyId === id).lines.map((l: { category: string; shareCents: number }) => [l.category, l.shareCents]));
    expect(shares(t1)).toEqual({ insurance: 60000, street_cleaning_waste: 18250, water_supply: 48667 });
    expect(shares(t2)).toEqual({ insurance: 20164, street_cleaning_waste: 9200, water_supply: 12267 });
    // T1: 1269.17 - 1200.00 = 69.17 to pay. T2: 416.31 - 300.00 = 116.31 to pay.
    expect(result.statements.map((s: { balanceCents: number }) => s.balanceCents)).toEqual([6917, 11631]);
    expect(result.landlordCents).toBe(40952);

    const missing = await call(anna, "POST", "/settlements/preview", { ...config(), keys: { insurance: { key: "area" } } });
    expect([missing.status, missing.body]).toEqual([422, { code: "settlement_key_missing", fields: ["keys.water_supply"] }]);
    const noPersons = await call(anna, "POST", "/settlements/preview", { ...config(), personsByTenancy: {}, vacancyPersons: null });
    expect(noPersons.body).toEqual({ code: "settlement_persons_missing", fields: [`personsByTenancy.${t1}`, `personsByTenancy.${t2}`, "vacancyPersons"] });
    expect(await ok(anna, "GET", "/settlements")).toEqual([]);
  });

  it("stores the settlement once and charges the balances", async () => {
    const settlement = await ok(anna, "POST", "/settlements", { ...config(), dueDate: "2027-02-15" });
    expect(settlement).toMatchObject({ propertyId: property, ...period, dueDate: "2027-02-15" });
    expect(settlement.result.ruleSetId).toBe("de-2024-01");
    expect(Object.keys(settlement.chargeIds).sort()).toEqual([t1, t2].sort());

    const charges = await ok(anna, "GET", `/charges?tenancyId=${t1}&status=open`);
    expect(charges).toEqual([
      { id: settlement.chargeIds[t1], tenancyId: t1, month: "2027-02", kind: "settlement_balance", amountCents: 6917, dueDate: "2027-02-15", cancelled: false, openCents: 6917 },
    ]);
    expect(await ok(anna, "GET", `/settlements/${settlement.id}`)).toEqual(settlement);
    expect(await ok(anna, "GET", `/settlements?propertyId=${property}`)).toEqual([
      { id: settlement.id, propertyId: property, ...period, createdAt: settlement.createdAt, statementCount: 2 },
    ]);

    // A second settlement overlapping the period is refused.
    const again = await call(anna, "POST", "/settlements", { ...config(), dueDate: "2027-03-15" });
    expect([again.status, again.body]).toEqual([409, { code: "conflict" }]);
  });

  it("books the paid balance as settlement income", async () => {
    const payment = await ok(anna, "POST", "/payments", { tenancyId: t1, receivedOn: "2027-02-10", amountCents: 6917 });
    expect(payment.unallocatedCents).toBe(0);
    const lines = await api.sql<{ code: string; amount: string }>(
      `SELECT a.code, l.amount_cents::text AS amount FROM payment p JOIN journal_line l ON l.entry_id = p.journal_entry_id
       JOIN account a ON a.id = l.account_id WHERE p.id = $1 ORDER BY a.code`,
      [payment.id],
    );
    expect(lines.map((l) => [l.code, l.amount])).toEqual([
      ["180000", "6917"],
      ["410850", "-6917"],
    ]);
  });

  it("refuses the area key when an area changes within the period", async () => {
    await ok(anna, "PUT", `/units/${unitB}/area`, { areaCentiSqm: 4100, validFrom: "2026-06-01" });
    const draft = await ok(anna, "GET", `/settlements/draft?propertyId=${property}&from=2026-01-01&to=2026-12-31`);
    expect(draft.units.find((u: { id: string }) => u.id === unitB).areaCentiSqm).toBeNull();
    expect((await call(anna, "POST", "/settlements/preview", config())).body).toEqual({ code: "settlement_unit_area", fields: [`units.${unitB}`] });
  });

  it("keeps settlements apart between organizations and immutable", async () => {
    const [summary] = await ok(anna, "GET", "/settlements");
    expect((await call(ben, "GET", `/settlements/${summary.id}`)).status).toBe(404);
    expect((await call(ben, "GET", `/settlements/draft?propertyId=${property}&from=2026-01-01&to=2026-12-31`)).status).toBe(404);
    expect(await ok(ben, "GET", "/settlements")).toEqual([]);

    const [row] = await api.sql<{ tenant_id: string }>("SELECT tenant_id FROM settlement LIMIT 1");
    await api.sql("BEGIN");
    try {
      await api.sql("SET LOCAL ROLE hv_app");
      await api.sql("SELECT set_config('app.tenant_id', $1, true)", [row!.tenant_id]);
      await expect(api.sql("UPDATE settlement SET due_date = '2030-01-01'")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await api.sql("ROLLBACK");
    }
  });
});
