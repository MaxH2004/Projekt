import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

// Invented statements; the IBANs are published sample numbers.
const OWN_IBAN = "DE89370400440532013000";
const TENANT_IBAN = "DE02120300000000202051";

let api: TestApp;
let anna: string;
let ben: string;
let tenancy: string;

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

const entry = (o: { ref: string; amount: string; dir: "CRDT" | "DBIT"; date: string; status?: string; name?: string; iban?: string; text?: string }) => `
  <Ntry>
    <Amt Ccy="EUR">${o.amount}</Amt><CdtDbtInd>${o.dir}</CdtDbtInd><Sts>${o.status ?? "BOOK"}</Sts>
    <BookgDt><Dt>${o.date}</Dt></BookgDt><ValDt><Dt>${o.date}</Dt></ValDt><AcctSvcrRef>${o.ref}</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties>
      <${o.dir === "CRDT" ? "Dbtr" : "Cdtr"}><Nm>${o.name ?? ""}</Nm></${o.dir === "CRDT" ? "Dbtr" : "Cdtr"}>
      <${o.dir === "CRDT" ? "DbtrAcct" : "CdtrAcct"}><Id><IBAN>${o.iban ?? TENANT_IBAN}</IBAN></Id></${o.dir === "CRDT" ? "DbtrAcct" : "CdtrAcct"}>
    </RltdPties><RmtInf><Ustrd>${o.text ?? ""}</Ustrd></RmtInf></TxDtls></NtryDtls>
  </Ntry>`;
const camt = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>
  <GrpHdr><MsgId>M</MsgId><CreDtTm>2026-04-01T08:00:00</CreDtTm></GrpHdr>
  <Stmt><Id>S</Id><Acct><Id><IBAN>${OWN_IBAN}</IBAN></Id></Acct>${entries}</Stmt>
</BkToCstmrStmt></Document>`;

const march = camt(
  entry({ ref: "R1", amount: "850.00", dir: "CRDT", date: "2026-03-02", name: "Erika Mueller", text: "Rent March" }) +
    entry({ ref: "R2", amount: "42.50", dir: "DBIT", date: "2026-03-05", name: "Waste Ltd", iban: "DE75512108001245126199" }) +
    entry({ ref: "R3", amount: "10.00", dir: "CRDT", date: "2026-03-31", status: "PDNG" }),
);

const transactions = async (cookie: string, query = "") => (await ok(cookie, "GET", `/bank-transactions${query}`)) as { id: string; amountCents: number; status: string; paymentId: string | null; suggestions: { tenancyId: string; score: number; reasons: string[] }[] }[];

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));

  const property = await ok(anna, "POST", "/properties", { name: "Linden Street 5" });
  const building = await ok(anna, "POST", `/properties/${property.id}/buildings`, { street: "Linden Street 5", postalCode: "12345", city: "Sampletown" });
  const unit = await ok(anna, "POST", `/buildings/${building.id}/units`, { label: "GF left" });
  const other = await ok(anna, "POST", `/buildings/${building.id}/units`, { label: "GF right" });
  const mueller = await ok(anna, "POST", "/persons", { kind: "natural", givenName: "Erika", familyName: "Müller" });
  const sample = await ok(anna, "POST", "/persons", { kind: "natural", familyName: "Sample" });
  // 700.00 + 150.00 = 850.00 per month.
  tenancy = (await ok(anna, "POST", "/tenancies", { unitId: unit.id, startDate: "2026-01-01", personIds: [mueller.id], baseRentCents: 70000, operatingCostAdvanceCents: 15000 })).id;
  await ok(anna, "POST", "/tenancies", { unitId: other.id, startDate: "2026-01-01", personIds: [sample.id], baseRentCents: 60000 });
  await ok(anna, "POST", "/charges/generate", { month: "2026-03" });
});

afterAll(() => api.close());

describe("import", () => {
  it("stores booked entries once and reports duplicates and skipped entries", async () => {
    expect(await ok(anna, "POST", "/bank-imports", { format: "camt053", content: march })).toEqual({
      accounts: [{ iban: OWN_IBAN, imported: 2, duplicates: 0, skipped: 1 }],
    });
    expect(await ok(anna, "POST", "/bank-imports", { format: "camt053", content: march })).toEqual({
      accounts: [{ iban: OWN_IBAN, imported: 0, duplicates: 2, skipped: 1 }],
    });
    expect((await transactions(anna)).map((t) => t.amountCents)).toEqual([85000, -4250]);
  });

  it("refuses unreadable files and accepts statements larger than the default body limit", async () => {
    expect(await call(anna, "POST", "/bank-imports", { format: "camt053", content: "<x/>" })).toEqual({ status: 400, body: { code: "bank_statement_unreadable" } });
    expect((await call(anna, "POST", "/bank-imports", { format: "csv", content: march })).body).toEqual({ code: "validation_failed", fields: ["format"] });

    const many = Array.from({ length: 400 }, (_, i) => entry({ ref: `BIG${i}`, amount: "1.00", dir: "DBIT", date: "2026-02-01", name: "Shop", text: "x".repeat(100) })).join("");
    const big = camt(many);
    expect(big.length).toBeGreaterThan(200_000);
    expect((await ok(ben, "POST", "/bank-imports", { format: "camt053", content: big })).accounts[0].imported).toBe(400);
  });

  it("keeps the transactions of each organization apart", async () => {
    expect((await transactions(ben)).every((t) => t.amountCents === -100)).toBe(true);
    expect(await transactions(anna)).toHaveLength(2);
  });
});

describe("suggestions and booking", () => {
  it("suggest the tenancy whose amount and name match", async () => {
    const [incoming, outgoing] = await transactions(anna, "?status=open");
    expect(incoming!.suggestions).toEqual([{ tenancyId: tenancy, score: 3, reasons: ["amount_matches", "name_matches"] }]);
    expect(outgoing!.suggestions).toEqual([]);
  });

  it("books an incoming transaction as a payment covering the open charges", async () => {
    const [incoming] = await transactions(anna, "?status=open");
    const payment = await ok(anna, "POST", `/bank-transactions/${incoming!.id}/book`, { tenancyId: tenancy });
    expect(payment).toMatchObject({ receivedOn: "2026-03-02", amountCents: 85000, unallocatedCents: 0, reference: "Rent March", bankTransactionId: incoming!.id });
    expect(await ok(anna, "GET", `/charges?tenancyId=${tenancy}&status=open`)).toEqual([]);

    const [booked] = await transactions(anna);
    expect(booked).toMatchObject({ status: "booked", paymentId: payment.id, suggestions: [] });
    expect((await transactions(anna, "?status=open")).map((t) => t.amountCents)).toEqual([-4250]);
  });

  it("refuses to book twice, to book outgoing money and to book for another organization", async () => {
    const [incoming, outgoing] = await transactions(anna);
    expect(await call(anna, "POST", `/bank-transactions/${incoming!.id}/book`, { tenancyId: tenancy })).toEqual({ status: 409, body: { code: "bank_transaction_not_bookable" } });
    expect((await call(anna, "POST", `/bank-transactions/${outgoing!.id}/book`, { tenancyId: tenancy })).body.code).toBe("bank_transaction_not_bookable");
    expect((await call(ben, "POST", `/bank-transactions/${outgoing!.id}/book`, { tenancyId: tenancy })).status).toBe(404);
  });

  it("recognises the tenant's IBAN once a transaction from it was booked", async () => {
    const april = camt(entry({ ref: "R4", amount: "800.00", dir: "CRDT", date: "2026-04-03", name: "E M", text: "April" }));
    await ok(anna, "POST", "/bank-imports", { format: "camt053", content: april });
    const open = await transactions(anna, "?status=open");
    expect(open.find((t) => t.amountCents === 80000)!.suggestions).toEqual([{ tenancyId: tenancy, score: 4, reasons: ["known_iban"] }]);
  });

  it("opens the transaction again when its payment is reversed", async () => {
    const [booked] = await transactions(anna);
    await ok(anna, "POST", `/payments/${booked!.paymentId}/reverse`, { bookingDate: "2026-03-10" });
    const [again] = await transactions(anna);
    expect(again).toMatchObject({ status: "open", paymentId: null });
    // Booking it again works; the reversed payment no longer counts.
    expect((await call(anna, "POST", `/bank-transactions/${again!.id}/book`, { tenancyId: tenancy })).status).toBe(201);
  });
});

describe("ignoring", () => {
  it("hides a transaction from the open list and can be undone, but not for a booked one", async () => {
    const all = await transactions(anna);
    const outgoing = all.find((t) => t.amountCents === -4250)!;
    expect((await ok(anna, "PUT", `/bank-transactions/${outgoing.id}/ignored`, { ignored: true })).status).toBe("ignored");
    expect((await transactions(anna, "?status=open")).some((t) => t.id === outgoing.id)).toBe(false);
    expect((await ok(anna, "PUT", `/bank-transactions/${outgoing.id}/ignored`, { ignored: false })).status).toBe("open");

    const booked = all.find((t) => t.status === "booked")!;
    expect((await call(anna, "PUT", `/bank-transactions/${booked.id}/ignored`, { ignored: true })).body).toEqual({ code: "bank_transaction_not_bookable" });
    expect((await call(ben, "PUT", `/bank-transactions/${outgoing.id}/ignored`, { ignored: true })).status).toBe(404);
  });
});

describe("database guards", () => {
  it("refuse a payment whose amount or date differs from its bank transaction", async () => {
    const open = (await transactions(anna, "?status=open")).find((t) => t.amountCents === 80000)!;
    const [existing] = await api.sql<{ tenant_id: string; entry_id: string }>("SELECT tenant_id, journal_entry_id AS entry_id FROM payment LIMIT 1");
    const { tenant_id: tenantId, entry_id: entryId } = existing!;
    await expect(
      api.sql(
        `INSERT INTO payment (tenant_id, tenancy_id, received_on, amount_cents, journal_entry_id, bank_transaction_id)
         VALUES ($1, $2, '2026-04-03', 79999, $3, $4)`,
        [tenantId, tenancy, entryId, open.id],
      ),
    ).rejects.toThrow(/does not match its bank transaction/);
  });
});
