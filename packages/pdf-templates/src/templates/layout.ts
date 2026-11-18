import { html, type SafeHtml } from "../html.js";
import type { Translator } from "../i18n.js";

/** Shared A4 page frame for all letters. */
export function letterLayout(tr: Translator, title: string, body: SafeHtml): SafeHtml {
  return html`<!doctype html>
<html lang="${tr.locale}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 25mm 20mm 20mm 25mm; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
  h1 { font-size: 14pt; margin: 18mm 0 6mm; }
  table { width: 100%; border-collapse: collapse; margin: 5mm 0; }
  th, td { padding: 1.5mm 2mm; border-bottom: 0.2mm solid #999; text-align: left; }
  th.amount, td.amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: bold; border-bottom: none; }
  .sender { margin-top: 15mm; font-size: 8pt; color: #444; }
  .address { margin-top: 3mm; min-height: 30mm; white-space: pre-line; }
  .date { text-align: right; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** The sender in one small line above the recipient's address. */
export function senderLine(name: string, address: readonly string[]): SafeHtml {
  return html`<div class="sender">${[name, ...address].filter((part) => part.trim()).join(" · ")}</div>`;
}
