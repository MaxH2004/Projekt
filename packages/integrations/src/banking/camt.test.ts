import { describe, expect, it } from "vitest";
import { CamtFormatError, parseCamt053 } from "../index.js";

// Invented statements. The IBANs are the published sample numbers, no real accounts.

const entry = (inner: string) => `<Ntry>${inner}</Ntry>`;
const statement = (version: string, entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.${version}">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>M1</MsgId><CreDtTm>2026-04-01T08:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>S1</Id>
      <Acct><Id><IBAN>DE89 3704 0044 0532 0130 00</IBAN></Id></Acct>
      ${entries}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

const rentV2 = entry(`
  <Amt Ccy="EUR">850.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
  <BookgDt><Dt>2026-03-02</Dt></BookgDt><ValDt><Dt>2026-03-02</Dt></ValDt>
  <AcctSvcrRef>2026030212345</AcctSvcrRef>
  <NtryDtls><TxDtls>
    <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
    <RltdPties><Dbtr><Nm>Erika Sample</Nm></Dbtr><DbtrAcct><Id><IBAN>DE02120300000000202051</IBAN></Id></DbtrAcct></RltdPties>
    <RmtInf><Ustrd>Rent March</Ustrd><Ustrd>GF left</Ustrd></RmtInf>
  </TxDtls></NtryDtls>`);

describe("camt.053", () => {
  it("reads a booked credit of version 001.02", () => {
    const [stmt] = parseCamt053(statement("02", rentV2));
    expect(stmt).toEqual({
      iban: "DE89370400440532013000",
      skipped: [],
      transactions: [
        {
          providerTransactionId: "ref:2026030212345",
          bookingDate: "2026-03-02",
          valueDate: "2026-03-02",
          amountCents: 85000n,
          currency: "EUR",
          counterpartyName: "Erika Sample",
          counterpartyIban: "DE02120300000000202051",
          remittanceInfo: "Rent March GF left",
        },
      ],
    });
  });

  it("reads a debit of version 001.08 with nested status and party", () => {
    const xml = statement(
      "08",
      entry(`
        <Amt Ccy="EUR">42.5</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><DtTm>2026-03-31T23:59:00</DtTm></BookgDt>
        <NtryDtls><TxDtls>
          <RltdPties><Cdtr><Pty><Nm>Waste &amp; Co</Nm></Pty></Cdtr><CdtrAcct><Id><IBAN>DE02120300000000202051</IBAN></Id></CdtrAcct></RltdPties>
        </TxDtls></NtryDtls>
        <AddtlNtryInf>Direct debit</AddtlNtryInf>`),
    );
    const [t] = parseCamt053(xml)[0]!.transactions;
    expect(t).toMatchObject({ amountCents: -4250n, bookingDate: "2026-03-31", valueDate: null, counterpartyName: "Waste & Co", remittanceInfo: "Direct debit" });
  });

  it("skips pending and foreign currency entries", () => {
    const xml = statement(
      "02",
      entry(`<Amt Ccy="EUR">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-03-03</Dt></BookgDt>`) +
        entry(`<Amt Ccy="CHF">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-04</Dt></BookgDt>`),
    );
    expect(parseCamt053(xml)[0]).toMatchObject({
      transactions: [],
      skipped: [
        { reason: "not_booked", bookingDate: "2026-03-03" },
        { reason: "not_eur", bookingDate: "2026-03-04" },
      ],
    });
  });

  it("gives identical entries without bank reference stable, distinct ids", () => {
    const same = entry(`<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-05</Dt></BookgDt><AcctSvcrRef>NONREF</AcctSvcrRef>`);
    const ids = () => parseCamt053(statement("02", same + same))[0]!.transactions.map((t) => t.providerTransactionId);
    expect(ids()).toEqual(["key:2026-03-05|1000|||#1", "key:2026-03-05|1000|||#2"]);
    expect(ids()).toEqual(ids());
  });

  it("does not trust a bank reference that repeats in the statement", () => {
    const withRef = (amount: string) =>
      entry(`<Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-05</Dt></BookgDt><AcctSvcrRef>X</AcctSvcrRef>`);
    const ids = parseCamt053(statement("02", withRef("1.00") + withRef("2.00")))[0]!.transactions.map((t) => t.providerTransactionId);
    expect(ids).toEqual(["key:2026-03-05|100|||#1", "key:2026-03-05|200|||#1"]);
  });

  it("rejects what is not a statement", () => {
    expect(() => parseCamt053("<html></html>")).toThrow(CamtFormatError);
    expect(() => parseCamt053("not xml at all <")).toThrow(CamtFormatError);
    expect(() => parseCamt053(`<!DOCTYPE x [<!ENTITY a "aaaa">]>${statement("02", rentV2)}`)).toThrow(/document type/);
    const badAmount = entry(`<Amt Ccy="EUR">1,00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-05</Dt></BookgDt>`);
    expect(() => parseCamt053(statement("02", badAmount))).toThrow(/invalid amount/);
  });
});
