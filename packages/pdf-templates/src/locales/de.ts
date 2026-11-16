/**
 * German is the reference catalog: its keys define what every other locale
 * must provide. Placeholders in braces are filled by the template.
 */
export const de = {
  "common.page": "Seite {page} von {pages}",
  "paymentReminder.title": "Zahlungserinnerung",
  "paymentReminder.salutation": "Guten Tag {name},",
  "paymentReminder.intro": "für das Mietverhältnis {unit} ist nach unseren Unterlagen folgender Betrag offen:",
  "paymentReminder.column.dueDate": "Fällig am",
  "paymentReminder.column.description": "Bezeichnung",
  "paymentReminder.column.amount": "Betrag",
  "paymentReminder.total": "Offener Gesamtbetrag",
  "paymentReminder.request": "Bitte überweisen Sie den Betrag bis zum {date} auf das Konto {iban}.",
  "paymentReminder.disregard": "Sollten Sie bereits gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.",
  "paymentReminder.closing": "Mit freundlichen Grüßen",
} as const;

export type MessageKey = keyof typeof de;
export type Catalog = Readonly<Record<MessageKey, string>>;
