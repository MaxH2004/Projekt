import type { Locale } from "@hv/contracts";
import { createTranslator } from "./i18n.js";
import { operatingCostStatement, type OperatingCostStatementData } from "./templates/operating-cost-statement.js";
import { paymentReminder, type PaymentReminderData } from "./templates/payment-reminder.js";

export { CATALOGS, createTranslator, type Translator } from "./i18n.js";
export type { Catalog, MessageKey } from "./locales/de.js";
export type { PaymentReminderData } from "./templates/payment-reminder.js";
export type { OperatingCostStatementData } from "./templates/operating-cost-statement.js";

/** Data each template needs. A new template is added here and in `TEMPLATES`. */
export interface TemplateData {
  "payment-reminder": PaymentReminderData;
  "operating-cost-statement": OperatingCostStatementData;
}
export type TemplateId = keyof TemplateData;

const TEMPLATES: { [K in TemplateId]: (tr: ReturnType<typeof createTranslator>, data: TemplateData[K]) => string } = {
  "payment-reminder": paymentReminder,
  "operating-cost-statement": operatingCostStatement,
};

/** Renders a document as a complete HTML page in the given language. */
export function renderTemplate<K extends TemplateId>(id: K, locale: Locale, data: TemplateData[K]): string {
  return TEMPLATES[id](createTranslator(locale), data);
}
