import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

let api: TestApp;
let anna: string;
let ben: string;
let tenancy: string;
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

/** Ledger lines of an entry as account code and amount, with full rights. */
const linesOf = (entryId: string) =>
  api.sql<{ code: string; amount: string; property_id: string }>(
    `SELECT a.code, l.amount_cents::text AS amount, l.property_id FROM journal_line l JOIN account a ON a.id = l.account_id
     WHERE l.entry_id = $1 ORDER BY a.code, l.amount_cents`,
    [entryId],
  );
const entryOf = async (paymentId: string) =>
  (await api.sql<{ journal_entry_id: string; reversal_entry_id: string | null }>("SELECT journal_entry_id, reversal_entry_id FROM payment WHERE id = $1", [paymentId]))[0]!;

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));

  property = (await ok(anna, "POST", "/properties", { name: "Linden Street 5" })).id;
  const building = await ok(anna, "POST", `/properties/${property}/buildings`, { street: "Linden Street 5", postalCode: "12345", city: "Sampletown" });
  const unit = await ok(anna, "POST", `/buildings/${building.id}/units`, { label: "GF left" });
  const person = await ok(anna, "POST", "/persons", { kind: "natural", familyName: "Sample" });
  // Moves in on 15 February 2026: 700.00 base rent, 150.00 operating cost advance, 80.00 heating cost advance.
  tenancy = (
    await ok(anna, "POST", "/tenancies", {
      unitId: unit.id,
      startDate: "2026-02-15",
      personIds: [person.id],
      baseRentCents: 70000,
      operatingCostAdvanceCents: 15000,
      heatingCostAdvanceCents: 8000,
    })
  ).id;
  // Base rent rises to 760.00 from 1 April 2026.
  await ok(anna, "PUT", `/tenancies/${tenancy}/rent`, { kind: "base_rent", amountCents: 76000, validFrom: "2026-04-01" });
});

afterAll(() => api.close());

describe("rent charges", () => {
  it("are prorated in the first month", async () => {
    // February 2026: 14 of 28 days, exactly half of each amount.
    const charges = await ok(anna, "POST", "/charges/generate", { month: "2026-02" });
    expect(charges.map((c: { kind: string; amountCents: number; dueDate: string; openCents: number }) => [c.kind, c.amountCents, c.dueDate, c.openCents])).toEqual([
      ["base_rent", 35000, "2026-02-15", 35000],
      ["operating_cost_advance", 7500, "2026-02-15", 7500],
      ["heating_cost_advance", 4000, "2026-02-15", 4000],
    ]);
  });

  it("are created once per month, however often the month is run", async () => {
    expect(await ok(anna, "POST", "/charges/generate", { month: "2026-03" })).toHaveLength(3);
    expect(await ok(anna, "POST", "/charges/generate", { month: "2026-03" })).toEqual([]);
    expect(await ok(anna, "POST", "/charges/generate", { month: "2026-04" })).toHaveLength(3);
    const april = await ok(anna, "GET", `/charges?month=2026-04&tenancyId=${tenancy}`);
    expect(april.find((c: { kind: string }) => c.kind === "base_rent").amountCents).toBe(76000);
  });

  it("are not created before the tenancy and not for another organization", async () => {
    expect(await ok(anna, "POST", "/charges/generate", { month: "2026-01" })).toEqual([]);
    expect(await ok(ben, "POST", "/charges/generate", { month: "2026-03" })).toEqual([]);
    expect(await ok(ben, "GET", "/charges")).toEqual([]);
  });

  it("validate the month", async () => {
    expect((await call(anna, "POST", "/charges/generate", { month: "2026-13" })).body).toEqual({ code: "validation_failed", fields: ["month"] });
    expect((await call(anna, "GET", "/charges?month=2026-1")).status).toBe(400);
  });
});

describe("payments", () => {
  // Charged for February to April: 465.00 + 930.00 + 990.00 = 2385.00
  it("cover the oldest charges first and book income per component", async () => {
    // 600.00: February in full (465.00), then March base rent 135.00 of 700.00.
    const payment = await ok(anna, "POST", "/payments", { tenancyId: tenancy, receivedOn: "2026-03-03", amountCents: 60000, reference: "Rent" });
    expect(payment).toMatchObject({ amountCents: 60000, unallocatedCents: 0, reversed: false, reference: "Rent" });
    expect(payment.allocations.map((a: { amountCents: number }) => a.amountCents).sort((a: number, b: number) => a - b)).toEqual([4000, 7500, 13500, 35000]);

    // Bank 600.00 against base rent 350.00 + 135.00 and advances 75.00 + 40.00.
    const lines = await linesOf((await entryOf(payment.id)).journal_entry_id);
    expect(lines.map((l) => [l.code, l.amount])).toEqual([
      ["180000", "60000"],
      ["410500", "-48500"],
      ["410800", "-11500"],
    ]);
    expect(lines.every((l) => l.property_id === property)).toBe(true);

    const open = await ok(anna, "GET", `/charges?tenancyId=${tenancy}&status=open`);
    expect(open.map((c: { month: string; kind: string; openCents: number }) => [c.month, c.kind, c.openCents])).toEqual([
      ["2026-03", "base_rent", 56500],
      ["2026-03", "operating_cost_advance", 15000],
      ["2026-03", "heating_cost_advance", 8000],
      ["2026-04", "base_rent", 76000],
      ["2026-04", "operating_cost_advance", 15000],
      ["2026-04", "heating_cost_advance", 8000],
    ]);
  });

  it("follow explicit allocations and keep the rest as tenant credit", async () => {
    const [aprilHeating] = (await ok(anna, "GET", `/charges?tenancyId=${tenancy}&month=2026-04`)).filter((c: { kind: string }) => c.kind === "heating_cost_advance");
    const payment = await ok(anna, "POST", "/payments", {
      tenancyId: tenancy,
      receivedOn: "2026-04-02",
      amountCents: 10000,
      allocations: [{ chargeId: aprilHeating.id, amountCents: 8000 }],
    });
    expect(payment.unallocatedCents).toBe(2000);
    const lines = await linesOf((await entryOf(payment.id)).journal_entry_id);
    expect(lines.map((l) => [l.code, l.amount])).toEqual([
      ["180000", "10000"],
      ["350000", "-2000"],
      ["410800", "-8000"],
    ]);
    // Charged 2385.00, paid 700.00, open 2385.00 - 600.00 - 80.00 = 1705.00, credit 20.00.
    expect(await ok(anna, "GET", `/tenancies/${tenancy}/balance`)).toEqual({
      tenancyId: tenancy,
      chargedCents: 238500,
      paidCents: 70000,
      openCents: 170500,
      creditCents: 2000,
    });
  });

  it("refuse allocations beyond the open amount or to unknown charges", async () => {
    const charges = await ok(anna, "GET", `/charges?tenancyId=${tenancy}&month=2026-04`);
    const heating = charges.find((c: { kind: string }) => c.kind === "heating_cost_advance");
    const base = charges.find((c: { kind: string }) => c.kind === "base_rent");
    const over = await call(anna, "POST", "/payments", {
      tenancyId: tenancy,
      receivedOn: "2026-04-03",
      amountCents: 100000,
      allocations: [{ chargeId: base.id, amountCents: 1000 }, { chargeId: heating.id, amountCents: 1 }],
    });
    expect([over.status, over.body]).toEqual([409, { code: "allocation_exceeds_open_amount", fields: ["allocations.1.amountCents"] }]);

    const unknown = await call(anna, "POST", "/payments", {
      tenancyId: tenancy,
      receivedOn: "2026-04-03",
      amountCents: 100,
      allocations: [{ chargeId: "00000000-0000-4000-8000-000000000000", amountCents: 100 }],
    });
    expect([unknown.status, unknown.body]).toEqual([404, { code: "not_found", fields: ["allocations.0.chargeId"] }]);

    const tooMuch = await call(anna, "POST", "/payments", { tenancyId: tenancy, receivedOn: "2026-04-03", amountCents: 100, allocations: [{ chargeId: base.id, amountCents: 101 }] });
    expect(tooMuch.body).toEqual({ code: "validation_failed", fields: ["allocations"] });
    expect((await call(anna, "POST", "/payments", { tenancyId: tenancy, receivedOn: "2026-04-03", amountCents: 0 })).body.code).toBe("validation_failed");
  });

  it("can be reversed once; the charges they covered are open again", async () => {
    const [first] = await ok(anna, "GET", `/payments?tenancyId=${tenancy}`);
    expect((await call(anna, "POST", `/payments/${first.id}/reverse`, { bookingDate: "2026-03-01" })).body).toEqual({ code: "validation_failed", fields: ["bookingDate"] });

    const reversed = await ok(anna, "POST", `/payments/${first.id}/reverse`, { bookingDate: "2026-03-10" });
    expect(reversed.reversed).toBe(true);
    const { journal_entry_id, reversal_entry_id } = await entryOf(first.id);
    const original = await linesOf(journal_entry_id);
    const reversal = await linesOf(reversal_entry_id!);
    expect(reversal.map((l) => [l.code, l.amount])).toEqual(original.map((l) => [l.code, String(-BigInt(l.amount))]));

    expect((await call(anna, "POST", `/payments/${first.id}/reverse`, { bookingDate: "2026-03-10" })).status).toBe(409);
    const balance = await ok(anna, "GET", `/tenancies/${tenancy}/balance`);
    // 1705.00 + 600.00 open again.
    expect(balance).toMatchObject({ paidCents: 10000, openCents: 230500, creditCents: 2000 });
  });

  it("are invisible to and unreachable for another organization", async () => {
    expect(await ok(ben, "GET", "/payments")).toEqual([]);
    const [payment] = await ok(anna, "GET", "/payments");
    expect((await call(ben, "POST", `/payments/${payment.id}/reverse`, { bookingDate: "2026-05-01" })).status).toBe(404);
    expect((await call(ben, "POST", "/payments", { tenancyId: tenancy, receivedOn: "2026-05-01", amountCents: 100 })).status).toBe(404);
    expect((await call(ben, "GET", `/tenancies/${tenancy}/balance`)).status).toBe(404);
  });
});

describe("cancelling a charge", () => {
  it("is refused while a payment covers it and allowed once nothing does", async () => {
    const charges = await ok(anna, "GET", `/charges?tenancyId=${tenancy}&month=2026-04`);
    const heating = charges.find((c: { kind: string }) => c.kind === "heating_cost_advance");
    const base = charges.find((c: { kind: string }) => c.kind === "base_rent");
    expect((await call(anna, "POST", `/charges/${heating.id}/cancel`)).status).toBe(409);

    const cancelled = await ok(anna, "POST", `/charges/${base.id}/cancel`);
    expect(cancelled).toMatchObject({ cancelled: true, openCents: 0 });
    expect((await call(anna, "POST", `/charges/${base.id}/cancel`)).status).toBe(409);
    expect((await call(ben, "POST", `/charges/${heating.id}/cancel`)).status).toBe(404);

    // A cancelled charge receives no money, not even through automatic allocation.
    const refused = await call(anna, "POST", "/payments", { tenancyId: tenancy, receivedOn: "2026-04-05", amountCents: 100, allocations: [{ chargeId: base.id, amountCents: 100 }] });
    expect(refused.body.code).toBe("allocation_exceeds_open_amount");
    const auto = await ok(anna, "POST", "/payments", { tenancyId: tenancy, receivedOn: "2026-04-05", amountCents: 1_000_000 });
    expect(auto.allocations.some((a: { chargeId: string }) => a.chargeId === base.id)).toBe(false);
    // Open before: 2305.00 minus the cancelled 760.00 = 1545.00; the rest is credit.
    expect(auto.unallocatedCents).toBe(1_000_000 - 154500);
    expect(await ok(anna, "GET", `/charges?tenancyId=${tenancy}&status=open`)).toEqual([]);
  });
});

describe("database guards", () => {
  it("refuse to change or delete allocations and to over-allocate a charge", async () => {
    const [allocation] = await api.sql<{ payment_id: string; charge_id: string; tenant_id: string }>("SELECT payment_id, charge_id, tenant_id FROM payment_allocation LIMIT 1");
    const asApp = async (sql: string, params: unknown[]) => {
      await api.sql("BEGIN");
      try {
        await api.sql("SET LOCAL ROLE hv_app");
        await api.sql("SELECT set_config('app.tenant_id', $1, true)", [allocation!.tenant_id]);
        await api.sql(sql, params);
        await api.sql("COMMIT");
        return "ok";
      } catch (err) {
        await api.sql("ROLLBACK");
        return (err as { code?: string }).code;
      }
    };
    expect(await asApp("DELETE FROM payment_allocation WHERE payment_id = $1", [allocation!.payment_id])).toBe("42501");
    expect(await asApp("UPDATE payment_allocation SET amount_cents = 1 WHERE payment_id = $1", [allocation!.payment_id])).toBe("42501");
    expect(await asApp("UPDATE rent_charge SET amount_cents = 1 WHERE id = $1", [allocation!.charge_id])).toBe("42501");
    expect(await asApp("DELETE FROM payment WHERE id = $1", [allocation!.payment_id])).toBe("42501");
  });
});
