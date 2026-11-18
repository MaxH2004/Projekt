import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

// Rent 500.00 a month (400.00 base rent + 100.00 advance). Amounts in the
// comments are calculated by hand.

let api: TestApp;
let anna: string;
let ben: string;
let property: string;
let tenancy: string;
let p1: string;
let p2: string;

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
const balance = () => ok(anna, "GET", `/tenancies/${tenancy}/balance`);
/** Ledger lines of the entries with a description, as account and amount. */
const lines = (description: string) =>
  api.sql<{ code: string; amount: string }>(
    `SELECT a.code, sum(l.amount_cents)::text AS amount FROM journal_entry e JOIN journal_line l ON l.entry_id = e.id
     JOIN account a ON a.id = l.account_id WHERE e.description = $1 GROUP BY a.code ORDER BY a.code`,
    [description],
  );

// Invented statement; the IBANs are published sample numbers.
const camt = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>
  <GrpHdr><MsgId>M</MsgId><CreDtTm>2026-06-01T08:00:00</CreDtTm></GrpHdr>
  <Stmt><Id>S</Id><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>${entries}</Stmt>
</BkToCstmrStmt></Document>`;
const entry = (ref: string, amount: string, dir: "CRDT" | "DBIT", date: string, name: string) =>
  `<Ntry><Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>${dir}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${date}</Dt></BookgDt><AcctSvcrRef>${ref}</AcctSvcrRef>
   <NtryDtls><TxDtls><RltdPties><${dir === "CRDT" ? "Dbtr" : "Cdtr"}><Nm>${name}</Nm></${dir === "CRDT" ? "Dbtr" : "Cdtr"}></RltdPties></TxDtls></NtryDtls></Ntry>`;

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));
  property = (await ok(anna, "POST", "/properties", { name: "P" })).id;
  const building = await ok(anna, "POST", `/properties/${property}/buildings`, { street: "S 1", postalCode: "1", city: "C" });
  const unit = await ok(anna, "POST", `/buildings/${building.id}/units`, { label: "U" });
  const person = await ok(anna, "POST", "/persons", { kind: "natural", familyName: "Sample" });
  tenancy = (await ok(anna, "POST", "/tenancies", { unitId: unit.id, startDate: "2026-01-01", personIds: [person.id], baseRentCents: 40000, operatingCostAdvanceCents: 10000 })).id;
  await ok(anna, "POST", "/charges/generate", { month: "2026-03" });
  await ok(anna, "POST", "/charges/generate", { month: "2026-04" });
});

afterAll(() => api.close());

describe("tenant credit", () => {
  it("is applied to later charges and moved from tenant credit to income", async () => {
    // 1200.00 covers March and April (1000.00); 200.00 stays as credit.
    p1 = (await ok(anna, "POST", "/payments", { tenancyId: tenancy, receivedOn: "2026-03-02", amountCents: 120000 })).id;
    expect((await balance()).creditCents).toBe(20000);

    // May: 500.00 open. The credit covers 200.00 of the May base rent.
    await ok(anna, "POST", "/charges/generate", { month: "2026-05" });
    expect(await ok(anna, "POST", `/tenancies/${tenancy}/apply-credit`, { bookingDate: "2026-05-02" })).toEqual({ appliedCents: 20000 });
    expect(await balance()).toMatchObject({ openCents: 30000, creditCents: 0 });
    expect((await lines("tenant_credit_applied")).map((l) => [l.code, l.amount])).toEqual([
      ["350000", "20000"],
      ["410500", "-20000"],
    ]);
    // Nothing left to apply.
    expect(await ok(anna, "POST", `/tenancies/${tenancy}/apply-credit`, { bookingDate: "2026-05-03" })).toEqual({ appliedCents: 0 });
  });

  it("is paid back only up to what is there", async () => {
    // 500.00 covers the 300.00 still open in May; 200.00 credit.
    p2 = (await ok(anna, "POST", "/payments", { tenancyId: tenancy, receivedOn: "2026-05-05", amountCents: 50000 })).id;
    const tooMuch = await call(anna, "POST", `/tenancies/${tenancy}/refunds`, { reason: "overpayment", amountCents: 30000, paidOn: "2026-05-10" });
    expect([tooMuch.status, tooMuch.body]).toEqual([409, { code: "credit_insufficient", fields: ["amountCents"] }]);

    const refund = await ok(anna, "POST", `/tenancies/${tenancy}/refunds`, { reason: "overpayment", amountCents: 15000, paidOn: "2026-05-10" });
    expect(refund).toMatchObject({ reason: "overpayment", amountCents: 15000, reversed: false });
    expect((await balance()).creditCents).toBe(5000);
    expect((await lines("tenant_credit_refund")).map((l) => [l.code, l.amount])).toEqual([
      ["180000", "-15000"],
      ["350000", "15000"],
    ]);
  });

  it("keeps a payment whose credit was paid out from being reversed", async () => {
    // Without P2 the credit would be 0 - 150.00.
    const res = await call(anna, "POST", `/payments/${p2}/reverse`, { bookingDate: "2026-05-20" });
    expect([res.status, res.body]).toEqual([409, { code: "credit_insufficient" }]);
    expect((await balance()).creditCents).toBe(5000);

    const [refund] = await ok(anna, "GET", `/tenancies/${tenancy}/refunds`);
    await ok(anna, "POST", `/refunds/${refund.id}/reverse`, { bookingDate: "2026-05-20" });
    await ok(anna, "POST", `/payments/${p2}/reverse`, { bookingDate: "2026-05-20" });
    expect((await balance()).creditCents).toBe(0);
  });

  it("reverses applied credit together with the payment it came from", async () => {
    await ok(anna, "POST", `/payments/${p1}/reverse`, { bookingDate: "2026-05-21" });
    // Everything is open again: March to May, 1500.00.
    expect(await balance()).toMatchObject({ openCents: 150000, creditCents: 0, paidCents: 0 });
    // The credit application and its reversal cancel out.
    expect((await lines("tenant_credit_applied_reversal")).map((l) => [l.code, l.amount])).toEqual([
      ["350000", "-20000"],
      ["410500", "20000"],
    ]);
    const [ledger] = await api.sql<{ balance: string }>("SELECT coalesce(sum(amount_cents), 0)::text AS balance FROM journal_line WHERE account_id = (SELECT id FROM account WHERE code = '350000' AND tenant_id = (SELECT tenant_id FROM tenancy LIMIT 1))");
    expect(ledger!.balance).toBe("0");
  });

  it("belongs to its organization only", async () => {
    expect((await call(ben, "POST", `/tenancies/${tenancy}/apply-credit`, { bookingDate: "2026-05-02" })).status).toBe(404);
    expect((await call(ben, "GET", `/tenancies/${tenancy}/refunds`)).body).toEqual([]);
  });
});

describe("settlement credit", () => {
  let settlement: string;

  it("is paid out once from an outgoing bank transaction, against settlement income", async () => {
    // A final settlement in which the tenant gets 45.00 back.
    const org = (await api.sql<{ tenant_id: string }>("SELECT tenant_id FROM tenancy WHERE id = $1", [tenancy]))[0]!.tenant_id;
    settlement = (await api.sql<{ id: string }>(
      `INSERT INTO settlement (tenant_id, property_id, period, rule_set_id, due_date, input, result)
       VALUES ($1, $2, daterange('2025-01-01', '2025-12-31', '[]'), 'de-2024-01', '2026-03-01', '{}', '{}') RETURNING id`,
      [org, property],
    ))[0]!.id;
    await api.sql(
      "INSERT INTO settlement_statement (tenant_id, settlement_id, tenancy_id, total_cents, advances_paid_cents, balance_cents) VALUES ($1, $2, $3, 115500, 120000, -4500)",
      [org, settlement, tenancy],
    );
    await ok(anna, "POST", "/bank-imports", { format: "camt053", content: camt(entry("R1", "45.00", "DBIT", "2026-06-01", "Sample")) });
    const [tx] = await ok(anna, "GET", "/bank-transactions?status=open");
    const refund = await ok(anna, "POST", `/bank-transactions/${tx.id}/book-refund`, { tenancyId: tenancy, reason: "settlement", settlementId: settlement });
    expect(refund).toMatchObject({ reason: "settlement", amountCents: 4500, bankTransactionId: tx.id });
    expect((await lines("tenant_credit_refund")).find((l) => l.code === "410850")?.amount).toBe("4500");
    expect((await ok(anna, "GET", "/bank-transactions"))[0]).toMatchObject({ status: "booked", refundId: refund.id });

    const again = await call(anna, "POST", `/tenancies/${tenancy}/refunds`, { reason: "settlement", settlementId: settlement, paidOn: "2026-06-02" });
    expect(again.status).toBe(409);
    expect((await ok(anna, "GET", `/settlements/${settlement}`)).refundIds).toEqual({ [tenancy]: refund.id });
  });

  it("blocks cancelling the settlement while the credit is paid out", async () => {
    expect((await call(anna, "POST", `/settlements/${settlement}/cancel`)).status).toBe(409);
    const [refund] = (await ok(anna, "GET", `/tenancies/${tenancy}/refunds`)).filter((r: { reason: string; reversed: boolean }) => r.reason === "settlement" && !r.reversed);
    await ok(anna, "POST", `/refunds/${refund.id}/reverse`, { bookingDate: "2026-06-02" });
    const cancelled = await ok(anna, "POST", `/settlements/${settlement}/cancel`);
    expect(cancelled.cancelled).toBe(true);
    expect((await call(anna, "POST", `/settlements/${settlement}/cancel`)).status).toBe(409);
    // A cancelled settlement pays nothing out.
    expect((await call(anna, "POST", `/tenancies/${tenancy}/refunds`, { reason: "settlement", settlementId: settlement, paidOn: "2026-06-03" })).status).toBe(404);
  });
});

describe("other bank bookings", () => {
  it("book a deposit received and a private withdrawal, and can be reversed", async () => {
    await ok(anna, "POST", "/bank-imports", {
      format: "camt053",
      content: camt(entry("D1", "1500.00", "CRDT", "2026-06-03", "Sample") + entry("W1", "100.00", "DBIT", "2026-06-04", "Anna")),
    });
    const open = await ok(anna, "GET", "/bank-transactions?status=open");
    const deposit = open.find((t: { amountCents: number }) => t.amountCents === 150000);
    const withdrawal = open.find((t: { amountCents: number }) => t.amountCents === -10000);

    expect((await call(anna, "POST", `/bank-transactions/${deposit.id}/book-other`, { accountCode: "180000" })).body).toEqual({ code: "validation_failed", fields: ["accountCode"] });
    const booked = await ok(anna, "POST", `/bank-transactions/${deposit.id}/book-other`, { accountCode: "355000", propertyId: property, description: "Kaution" });
    expect(booked).toMatchObject({ status: "booked", otherBookingId: expect.any(String) });
    await ok(anna, "POST", `/bank-transactions/${withdrawal.id}/book-other`, { accountCode: "210000" });
    expect((await lines("bank_booking")).map((l) => [l.code, l.amount])).toEqual([
      ["180000", "140000"],
      ["210000", "10000"],
      ["355000", "-150000"],
    ]);

    expect((await call(anna, "POST", `/bank-transactions/${deposit.id}/book-other`, { accountCode: "355000" })).body.code).toBe("bank_transaction_not_bookable");
    await call(anna, "POST", `/bank-bookings/${booked.otherBookingId}/reverse`, { bookingDate: "2026-06-05" }).then((r) => expect(r.status).toBe(204));
    expect((await ok(anna, "GET", "/bank-transactions?status=open")).map((t: { id: string }) => t.id)).toContain(deposit.id);
    expect((await call(ben, "POST", `/bank-bookings/${booked.otherBookingId}/reverse`, { bookingDate: "2026-06-05" })).status).toBe(404);
  });
});
