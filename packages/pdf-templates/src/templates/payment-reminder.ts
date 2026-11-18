import { formatIban } from "@hv/contracts";
import { html } from "../html.js";
import type { Translator } from "../i18n.js";
import { letterLayout, senderLine } from "./layout.js";

export interface PaymentReminderData {
  readonly senderName: string;
  /** Sender's postal address, one line per entry; may be empty. */
  readonly senderAddress: readonly string[];
  /** Postal address of the recipient, one line per entry. */
  readonly recipientAddress: readonly string[];
  readonly recipientName: string;
  readonly unitLabel: string;
  readonly letterDate: string;
  readonly payUntil: string;
  /** Account to pay to, without spaces; null if the sender has none on record. */
  readonly iban: string | null;
  readonly items: readonly { dueDate: string; description: string; amountCents: bigint }[];
}

export function paymentReminder(tr: Translator, data: PaymentReminderData): string {
  if (data.items.length === 0) throw new RangeError("A payment reminder needs at least one open item");
  const total = data.items.reduce((sum, item) => sum + item.amountCents, 0n);
  const title = tr.t("paymentReminder.title");

  const rows = data.items.map(
    (item) => html`<tr><td>${tr.date(item.dueDate)}</td><td>${item.description}</td><td class="amount">${tr.money(item.amountCents)}</td></tr>`,
  );

  return letterLayout(
    tr,
    title,
    html`${senderLine(data.senderName, data.senderAddress)}
<div class="address">${data.recipientAddress.join("\n")}</div>
<p class="date">${tr.date(data.letterDate)}</p>
<h1>${title}</h1>
<p>${tr.t("paymentReminder.salutation", { name: data.recipientName })}</p>
<p>${tr.t("paymentReminder.intro", { unit: data.unitLabel })}</p>
<table>
<thead><tr><th>${tr.t("paymentReminder.column.dueDate")}</th><th>${tr.t("paymentReminder.column.description")}</th><th class="amount">${tr.t("paymentReminder.column.amount")}</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="2">${tr.t("paymentReminder.total")}</td><td class="amount">${tr.money(total)}</td></tr></tfoot>
</table>
<p>${
      data.iban
        ? tr.t("paymentReminder.request", { date: tr.date(data.payUntil), iban: formatIban(data.iban) })
        : tr.t("paymentReminder.requestNoIban", { date: tr.date(data.payUntil) })
    }</p>
<p>${tr.t("paymentReminder.disregard")}</p>
<p>${tr.t("paymentReminder.closing")}<br>${data.senderName}</p>`,
  ).value;
}
