import { XMLParser } from "fast-xml-parser";
import type { BankTransaction } from "./port.js";

/**
 * Reader for account statements in ISO 20022 camt.053 (versions 001.02 to
 * 001.08), the format German banks offer for download. Only booked entries in
 * euro become transactions; everything else is reported as skipped.
 *
 * Written against the published structure of the message, not against files
 * of real banks; see docs/BACKLOG.md.
 */
export interface CamtStatement {
  /** IBAN of the account the statement belongs to. */
  readonly iban: string;
  readonly transactions: readonly BankTransaction[];
  readonly skipped: readonly { readonly reason: "not_booked" | "not_eur"; readonly bookingDate: string | null }[];
}

export class CamtFormatError extends Error {
  constructor(detail: string) {
    super(`Not a readable camt.053 statement: ${detail}`);
    this.name = "CamtFormatError";
  }
}

/** Placeholders banks put where they have no reference. */
const NO_REFERENCE = new Set(["", "NONREF", "NOTPROVIDED", "NOT PROVIDED"]);

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  // Keep every value as written: amounts and references must not become numbers.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ["Stmt", "Ntry", "TxDtls", "Ustrd"].includes(name),
  processEntities: true,
});

export function parseCamt053(xml: string): CamtStatement[] {
  // Statements need no DTD; refusing one rules out entity expansion attacks.
  if (/<!DOCTYPE/i.test(xml)) throw new CamtFormatError("document type declarations are not accepted");
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (err) {
    throw new CamtFormatError(err instanceof Error ? err.message : "invalid XML");
  }
  const statements = path(doc, "Document", "BkToCstmrStmt", "Stmt");
  if (!Array.isArray(statements) || statements.length === 0) throw new CamtFormatError("no statement");
  return statements.map((stmt) => readStatement(stmt as Node));
}

function readStatement(stmt: Node): CamtStatement {
  const iban = text(path(stmt, "Acct", "Id", "IBAN"))?.replace(/\s+/g, "").toUpperCase();
  if (!iban) throw new CamtFormatError("statement without IBAN");
  const entries = (path(stmt, "Ntry") as Node[] | undefined) ?? [];

  const read = entries.map((entry) => readEntry(entry));
  // A bank reference identifies an entry only if it is unique in the statement.
  const refCount = new Map<string, number>();
  for (const r of read) if (r.kind === "ok" && r.bankRef) refCount.set(r.bankRef, (refCount.get(r.bankRef) ?? 0) + 1);
  const keyCount = new Map<string, number>();

  const transactions: BankTransaction[] = [];
  const skipped: CamtStatement["skipped"][number][] = [];
  for (const r of read) {
    if (r.kind === "skip") {
      skipped.push({ reason: r.reason, bookingDate: r.bookingDate });
      continue;
    }
    let id: string;
    if (r.bankRef && refCount.get(r.bankRef) === 1) {
      id = `ref:${r.bankRef}`;
    } else {
      // No usable reference: the content of the entry plus its position among
      // identical ones, so the same statement imported twice gives the same ids.
      const t = r.transaction;
      const key = [t.bookingDate, t.amountCents, r.endToEndId ?? "", t.counterpartyIban ?? "", t.remittanceInfo].join("|");
      const n = (keyCount.get(key) ?? 0) + 1;
      keyCount.set(key, n);
      id = `key:${key}#${n}`;
    }
    transactions.push({ ...r.transaction, providerTransactionId: id });
  }
  return { iban, transactions, skipped };
}

type ReadEntry =
  | { kind: "ok"; transaction: Omit<BankTransaction, "providerTransactionId">; bankRef: string | null; endToEndId: string | null }
  | { kind: "skip"; reason: "not_booked" | "not_eur"; bookingDate: string | null };

function readEntry(entry: Node): ReadEntry {
  // 001.02 writes <Sts>BOOK</Sts>, later versions <Sts><Cd>BOOK</Cd></Sts>.
  const status = text(path(entry, "Sts", "Cd")) ?? text(path(entry, "Sts"));
  const bookingDate = date(path(entry, "BookgDt"));
  if (status !== "BOOK") return { kind: "skip", reason: "not_booked", bookingDate };
  if (!bookingDate) throw new CamtFormatError("booked entry without booking date");

  const amountNode = path(entry, "Amt") as Node | string | undefined;
  const currency = typeof amountNode === "object" ? text(amountNode["@Ccy"]) : null;
  if (currency !== "EUR") return { kind: "skip", reason: "not_eur", bookingDate };
  const magnitude = cents(typeof amountNode === "object" ? text(amountNode["#text"]) : text(amountNode));

  const direction = text(path(entry, "CdtDbtInd"));
  if (direction !== "CRDT" && direction !== "DBIT") throw new CamtFormatError("entry without credit or debit indicator");
  const incoming = direction === "CRDT";

  // Batch bookings carry several transaction details; the first one names the
  // counterparty. Splitting them is not supported, see docs/BACKLOG.md.
  const details = ((path(entry, "NtryDtls", "TxDtls") as Node[] | undefined) ?? [])[0] ?? {};
  const party = path(details, "RltdPties", incoming ? "Dbtr" : "Cdtr") as Node | undefined;
  const counterpartyName = text(path(party, "Pty", "Nm")) ?? text(path(party, "Nm"));
  const counterpartyIban = text(path(details, "RltdPties", incoming ? "DbtrAcct" : "CdtrAcct", "Id", "IBAN"))?.replace(/\s+/g, "").toUpperCase() ?? null;
  const unstructured = ((path(details, "RmtInf", "Ustrd") as unknown[] | undefined) ?? []).map(text).filter(Boolean).join(" ");
  const remittanceInfo = unstructured || text(path(entry, "AddtlNtryInf")) || "";

  return {
    kind: "ok",
    bankRef: reference(path(entry, "AcctSvcrRef")),
    endToEndId: reference(path(details, "Refs", "EndToEndId")),
    transaction: {
      bookingDate,
      valueDate: date(path(entry, "ValDt")),
      amountCents: incoming ? magnitude : -magnitude,
      currency: "EUR",
      counterpartyName: counterpartyName ?? null,
      counterpartyIban,
      remittanceInfo: remittanceInfo.replace(/\s+/g, " ").trim(),
    },
  };
}

function path(node: unknown, ...keys: string[]): unknown {
  let current = node;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Node)[key];
  }
  return current;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && value !== null && typeof (value as Node)["#text"] === "string") return text((value as Node)["#text"]);
  return null;
}

function reference(value: unknown): string | null {
  const ref = text(value);
  return ref === null || NO_REFERENCE.has(ref.toUpperCase()) ? null : ref;
}

/** <Dt>2026-03-02</Dt> or <DtTm>2026-03-02T10:00:00</DtTm>. */
function date(node: unknown): string | null {
  const value = text(path(node, "Dt")) ?? text(path(node, "DtTm"));
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new CamtFormatError(`invalid date ${value}`);
  return day;
}

function cents(value: string | null): bigint {
  const m = value === null ? null : /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw new CamtFormatError(`invalid amount ${value}`);
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}
