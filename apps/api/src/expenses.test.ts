import { OPERATING_COST_CATEGORY_KEYS } from "@hv/contracts";
import { OPERATING_COST_CATEGORIES } from "@hv/settlement-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "./test-support.js";

let api: TestApp;
let anna: string;
let ben: string;
let p1: string;
let p2: string;
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
const linesOf = (expenseId: string, column: "journal_entry_id" | "reversal_entry_id" = "journal_entry_id") =>
  api.sql<{ code: string; amount: string; property_id: string | null }>(
    `SELECT a.code, l.amount_cents::text AS amount, l.property_id FROM expense x
     JOIN journal_line l ON l.entry_id = x.${column} JOIN account a ON a.id = l.account_id
     WHERE x.id = $1 ORDER BY a.code, l.amount_cents`,
    [expenseId],
  );

// Invented statement; the IBANs are published sample numbers.
const outgoing = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>
  <GrpHdr><MsgId>M</MsgId><CreDtTm>2026-04-01T08:00:00</CreDtTm></GrpHdr>
  <Stmt><Id>S</Id><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>
    <Ntry><Amt Ccy="EUR">119.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-15</Dt></BookgDt><AcctSvcrRef>W1</AcctSvcrRef>
      <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Waste Ltd</Nm></Cdtr><CdtrAcct><Id><IBAN>DE02120300000000202051</IBAN></Id></CdtrAcct></RltdPties>
      <RmtInf><Ustrd>Waste Q1</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
    <Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-16</Dt></BookgDt><AcctSvcrRef>W2</AcctSvcrRef></Ntry>
  </Stmt>
</BkToCstmrStmt></Document>`;

beforeAll(async () => {
  api = await createTestApp();
  anna = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "anna@example.com", password, organizationName: "Anna" } }));
  ben = sessionCookie(await api.request("POST", "/auth/register", { body: { email: "ben@example.com", password, organizationName: "Ben" } }));

  p1 = (await ok(anna, "POST", "/properties", { name: "Linden Street 5" })).id;
  p2 = (await ok(anna, "POST", "/properties", { name: "Oak Road 2" })).id;
  const building = await ok(anna, "POST", `/properties/${p1}/buildings`, { street: "Linden Street 5", postalCode: "12345", city: "Sampletown" });
  const unit = await ok(anna, "POST", `/buildings/${building.id}/units`, { label: "GF left" });
  const person = await ok(anna, "POST", "/persons", { kind: "natural", familyName: "Sample" });
  tenancy = (await ok(anna, "POST", "/tenancies", { unitId: unit.id, startDate: "2026-01-01", personIds: [person.id], baseRentCents: 70000, operatingCostAdvanceCents: 15000 })).id;
  await ok(anna, "POST", "/charges/generate", { month: "2026-03" });
  await ok(anna, "POST", "/payments", { tenancyId: tenancy, receivedOn: "2026-03-02", amountCents: 85000 });
});

afterAll(() => api.close());

describe("categories", () => {
  it("are the same in the contracts and in the settlement engine", () => {
    expect([...OPERATING_COST_CATEGORY_KEYS].sort()).toEqual(Object.keys(OPERATING_COST_CATEGORIES).sort());
  });
});

describe("accounts", () => {
  it("lists the chart and marks the accounts expenses may book to", async () => {
    const accounts: { code: string; forExpenses: boolean }[] = await ok(anna, "GET", "/accounts");
    const flag = (code: string) => accounts.find((a) => a.code === code)?.forExpenses;
    expect([flag("632800"), flag("640000"), flag("622100"), flag("410500"), flag("180000")]).toEqual([true, true, false, false, false]);
  });
});

describe("expenses", () => {
  let insurance: { id: string };

  it("split over properties and book against private contributions", async () => {
    insurance = await ok(anna, "POST", "/expenses", {
      paidOn: "2026-03-10",
      paidFrom: "private",
      vendor: "Insurance Ltd",
      lines: [
        { accountCode: "640000", propertyId: p1, amountCents: 30000, operatingCostCategory: "insurance" },
        { accountCode: "640000", propertyId: p2, amountCents: 20000, operatingCostCategory: "insurance" },
      ],
    });
    expect(insurance).toMatchObject({ amountCents: 50000, paidFrom: "private", vendor: "Insurance Ltd", bankTransactionId: null, reversed: false });
    expect((await linesOf(insurance.id)).map((l) => [l.code, l.amount, l.property_id])).toEqual([
      ["218000", "-50000", null],
      ["640000", "20000", p2],
      ["640000", "30000", p1],
    ]);
  });

  it("refuse accounts that are not for expenses and foreign properties", async () => {
    const line = (accountCode: string, propertyId = p1) => ({ paidOn: "2026-03-10", paidFrom: "bank", lines: [{ accountCode, propertyId, amountCents: 100 }] });
    for (const code of ["410500", "622100", "180000", "999999"]) {
      expect((await call(anna, "POST", "/expenses", line(code))).body, code).toEqual({ code: "validation_failed", fields: ["lines.0.accountCode"] });
    }
    expect((await call(ben, "POST", "/expenses", line("640000", p1))).body).toEqual({ code: "not_found", fields: ["lines.0.propertyId"] });
    const badCategory = await call(anna, "POST", "/expenses", { ...line("640000"), lines: [{ accountCode: "640000", propertyId: p1, amountCents: 100, operatingCostCategory: "parking" }] });
    expect(badCategory.body).toEqual({ code: "validation_failed", fields: ["lines.0.operatingCostCategory"] });
  });

  it("filter by property and period", async () => {
    expect((await ok(anna, "GET", `/expenses?propertyId=${p2}`)).map((e: { id: string }) => e.id)).toEqual([insurance.id]);
    expect(await ok(anna, "GET", "/expenses?from=2026-03-11")).toEqual([]);
    expect((await call(anna, "GET", "/expenses?to=2026-02-30")).body).toEqual({ code: "validation_failed", fields: ["to"] });
    expect(await ok(ben, "GET", "/expenses")).toEqual([]);
  });
});

describe("outgoing bank transactions", () => {
  let waste: { id: string; bankTransactionId: string };

  it("are booked as expenses from the bank with the transaction's amount and date", async () => {
    await ok(anna, "POST", "/bank-imports", { format: "camt053", content: outgoing });
    const [tx, incoming] = await ok(anna, "GET", "/bank-transactions?status=open");

    const mismatch = await call(anna, "POST", `/bank-transactions/${tx.id}/book-expense`, { lines: [{ accountCode: "685900", propertyId: p1, amountCents: 11800 }] });
    expect(mismatch.body).toEqual({ code: "validation_failed", fields: ["lines"] });

    waste = await ok(anna, "POST", `/bank-transactions/${tx.id}/book-expense`, {
      lines: [{ accountCode: "685900", propertyId: p1, amountCents: 11900, operatingCostCategory: "street_cleaning_waste" }],
    });
    expect(waste).toMatchObject({ paidOn: "2026-03-15", amountCents: 11900, paidFrom: "bank", vendor: "Waste Ltd", bankTransactionId: tx.id });
    expect((await linesOf(waste.id)).map((l) => [l.code, l.amount])).toEqual([
      ["180000", "-11900"],
      ["685900", "11900"],
    ]);

    const [booked] = await ok(anna, "GET", "/bank-transactions");
    expect(booked).toMatchObject({ status: "booked", expenseId: waste.id, paymentId: null });

    const lines = [{ accountCode: "685900", propertyId: p1, amountCents: 500 }];
    expect((await call(anna, "POST", `/bank-transactions/${tx.id}/book-expense`, { lines: [{ accountCode: "685900", propertyId: p1, amountCents: 11900 }] })).body.code).toBe("bank_transaction_not_bookable");
    expect((await call(anna, "POST", `/bank-transactions/${incoming.id}/book-expense`, { lines })).body.code).toBe("bank_transaction_not_bookable");
    expect((await call(anna, "PUT", `/bank-transactions/${tx.id}/ignored`, { ignored: true })).body.code).toBe("bank_transaction_not_bookable");
    expect((await call(ben, "POST", `/bank-transactions/${tx.id}/book-expense`, { lines })).status).toBe(404);
  });

  it("show up in the income statement per property", async () => {
    const statement = await ok(anna, "GET", "/reports/income-statement?from=2026-01-01&to=2026-12-31");
    // P1: rent 700.00 + advance 150.00 = 850.00; insurance 300.00 + waste 119.00 = 419.00; result 431.00.
    // P2: insurance 200.00; result -200.00.
    expect(statement).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      properties: expect.arrayContaining([
        {
          propertyId: p1,
          accounts: [
            { code: "410500", type: "income", amountCents: 70000 },
            { code: "410800", type: "income", amountCents: 15000 },
            { code: "640000", type: "expense", amountCents: 30000 },
            { code: "685900", type: "expense", amountCents: 11900 },
          ],
          incomeCents: 85000,
          expenseCents: 41900,
          resultCents: 43100,
        },
        { propertyId: p2, accounts: [{ code: "640000", type: "expense", amountCents: 20000 }], incomeCents: 0, expenseCents: 20000, resultCents: -20000 },
      ]),
    });
    expect(statement.properties).toHaveLength(2);
    expect((await ok(anna, "GET", "/reports/income-statement?from=2026-04-01&to=2026-04-30")).properties).toEqual([]);
    expect((await call(anna, "GET", "/reports/income-statement?from=2026-05-01&to=2026-04-30")).body).toEqual({ code: "validation_failed", fields: ["to"] });
    expect((await ok(ben, "GET", "/reports/income-statement?from=2026-01-01&to=2026-12-31")).properties).toEqual([]);
  });

  it("are open again once their expense is reversed, and the statement nets the reversal", async () => {
    expect((await call(ben, "POST", `/expenses/${waste.id}/reverse`, { bookingDate: "2026-03-20" })).status).toBe(404);
    expect((await call(anna, "POST", `/expenses/${waste.id}/reverse`, { bookingDate: "2026-03-14" })).body).toEqual({ code: "validation_failed", fields: ["bookingDate"] });
    expect((await ok(anna, "POST", `/expenses/${waste.id}/reverse`, { bookingDate: "2026-03-20" })).reversed).toBe(true);
    expect((await call(anna, "POST", `/expenses/${waste.id}/reverse`, { bookingDate: "2026-03-20" })).status).toBe(409);

    const reversal = await linesOf(waste.id, "reversal_entry_id");
    expect(reversal.map((l) => [l.code, l.amount])).toEqual([
      ["180000", "11900"],
      ["685900", "-11900"],
    ]);
    const [tx] = await ok(anna, "GET", "/bank-transactions");
    expect(tx).toMatchObject({ status: "open", expenseId: null });

    const statement = await ok(anna, "GET", "/reports/income-statement?from=2026-01-01&to=2026-12-31");
    // 850.00 - 300.00 = 550.00
    expect(statement.properties.find((p: { propertyId: string }) => p.propertyId === p1)).toMatchObject({ expenseCents: 30000, resultCents: 55000 });
  });
});

describe("database guards", () => {
  it("refuse lines added to an expense after it was recorded", async () => {
    const [line] = await api.sql<{ tenant_id: string; expense_id: string; account_id: string; property_id: string }>(
      "SELECT tenant_id, expense_id, account_id, property_id FROM expense_line LIMIT 1",
    );
    await expect(
      api.sql("INSERT INTO expense_line (tenant_id, expense_id, account_id, property_id, amount_cents) VALUES ($1, $2, $3, $4, 1)", [
        line!.tenant_id,
        line!.expense_id,
        line!.account_id,
        line!.property_id,
      ]),
    ).rejects.toThrow(/already recorded/);
  });
});
