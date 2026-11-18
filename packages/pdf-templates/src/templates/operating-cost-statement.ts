import type { OperatingCostCategoryKey, SettlementKey } from "@hv/contracts";
import { html } from "../html.js";
import type { Translator } from "../i18n.js";
import { letterLayout } from "./layout.js";

export interface OperatingCostStatementData {
  readonly senderName: string;
  /** Postal address of the recipient, one line per entry. */
  readonly recipientAddress: readonly string[];
  readonly recipientName: string;
  /** Property and unit as the tenant knows them, e.g. "Linden Street 5, ground floor left". */
  readonly unitLabel: string;
  readonly letterDate: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  /** Days of the tenancy in the period, and the days of the period. */
  readonly days: number;
  readonly periodDays: number;
  readonly lines: readonly {
    readonly category: OperatingCostCategoryKey;
    readonly totalCostCents: bigint;
    readonly key: SettlementKey;
    /** Weight of the unit or tenancy and the total, as used for the share (area in centi-m²). */
    readonly ownWeight: number;
    readonly totalWeight: number;
    readonly shareCents: bigint;
  }[];
  readonly totalCents: bigint;
  readonly advancesPaidCents: bigint;
  /** Positive: the tenant pays. Negative: the tenant gets it back. */
  readonly balanceCents: bigint;
  readonly dueDate: string;
}

/**
 * Statement of operating costs for one tenancy. It shows for every cost type
 * the total, the key with the tenant's and the total weight, and the share,
 * then the advances paid and the balance.
 */
export function operatingCostStatement(tr: Translator, data: OperatingCostStatementData): string {
  if (data.lines.length === 0) throw new RangeError("A statement needs at least one cost");
  const title = tr.t("statement.title");
  const area = (centiSqm: number) => tr.decimal(centiSqm / 100, 2);
  const keyText = (line: OperatingCostStatementData["lines"][number]) => {
    switch (line.key) {
      case "area":
        return tr.t("statement.key.area", { own: area(line.ownWeight), total: area(line.totalWeight) });
      case "units":
        return tr.t("statement.key.units", { own: line.ownWeight, total: line.totalWeight });
      case "persons":
        return tr.t("statement.key.persons", { own: tr.decimal(line.ownWeight, 0), total: tr.decimal(line.totalWeight, 0) });
      case "direct":
        return tr.t("statement.key.direct");
    }
  };

  const rows = data.lines.map(
    (line) => html`<tr>
<td>${tr.t(`category.${line.category}`)}</td>
<td class="amount">${tr.money(line.totalCostCents)}</td>
<td>${keyText(line)}</td>
<td class="amount">${tr.money(line.shareCents)}</td>
</tr>`,
  );
  const partYear = data.days < data.periodDays;
  const balance =
    data.balanceCents > 0n
      ? html`<p><strong>${tr.t("statement.pay", { amount: tr.money(data.balanceCents), date: tr.date(data.dueDate) })}</strong></p>`
      : data.balanceCents < 0n
        ? html`<p><strong>${tr.t("statement.refund", { amount: tr.money(-data.balanceCents) })}</strong></p>`
        : html`<p><strong>${tr.t("statement.even")}</strong></p>`;

  return letterLayout(
    tr,
    title,
    html`<div class="address">${data.recipientAddress.join("\n")}</div>
<p class="date">${tr.date(data.letterDate)}</p>
<h1>${title}</h1>
<p>${tr.t("statement.subject", { unit: data.unitLabel, from: tr.date(data.periodFrom), to: tr.date(data.periodTo) })}</p>
<p>${tr.t("statement.salutation", { name: data.recipientName })}</p>
<p>${tr.t("statement.intro")}</p>
${partYear ? html`<p>${tr.t("statement.partYear", { days: data.days, periodDays: data.periodDays })}</p>` : html``}
<table>
<thead><tr><th>${tr.t("statement.column.category")}</th><th class="amount">${tr.t("statement.column.total")}</th><th>${tr.t("statement.column.key")}</th><th class="amount">${tr.t("statement.column.share")}</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot>
<tr><td colspan="3">${tr.t("statement.sum")}</td><td class="amount">${tr.money(data.totalCents)}</td></tr>
<tr><td colspan="3">${tr.t("statement.advances")}</td><td class="amount">${tr.money(-data.advancesPaidCents)}</td></tr>
<tr><td colspan="3">${tr.t(data.balanceCents >= 0n ? "statement.balanceDue" : "statement.balanceCredit")}</td><td class="amount">${tr.money(data.balanceCents < 0n ? -data.balanceCents : data.balanceCents)}</td></tr>
</tfoot>
</table>
${balance}
<p>${tr.t("statement.heating")}</p>
<p>${tr.t("statement.inspection")}</p>
<p>${tr.t("statement.closing")}<br>${data.senderName}</p>`,
  ).value;
}
