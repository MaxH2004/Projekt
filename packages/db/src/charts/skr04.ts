export interface ChartAccount {
  readonly code: string;
  /** Official German designation from the chart; reference data, not interface text. */
  readonly name: string;
  readonly type: "asset" | "liability" | "equity" | "income" | "expense";
}

/**
 * Subset of the DATEV standard chart SKR 04 needed for stage 1.
 * Only accounts whose number and name are confirmed by a source listed in
 * docs/domain-rules/chart-of-accounts.md are included. Do not add accounts
 * from memory.
 */
export const SKR04_RENTAL_SUBSET: readonly ChartAccount[] = [
  { code: "1200", name: "Forderungen aus Lieferungen und Leistungen", type: "asset" },
  { code: "1350", name: "Kautionen", type: "asset" },
  { code: "1600", name: "Kasse", type: "asset" },
  { code: "1800", name: "Bank", type: "asset" },
  { code: "3300", name: "Verbindlichkeiten aus Lieferungen und Leistungen", type: "liability" },
  { code: "3550", name: "Erhaltene Kautionen", type: "liability" },
  { code: "4105", name: "Steuerfreie Umsätze Vermietung und Verpachtung § 4 Nr. 12 UStG", type: "income" },
  { code: "6325", name: "Gas, Strom, Wasser", type: "expense" },
  { code: "6335", name: "Instandhaltung betrieblicher Räume", type: "expense" },
  { code: "6340", name: "Abgaben für betrieblich genutzten Grundbesitz", type: "expense" },
  { code: "6350", name: "Grundstücksaufwendungen, betrieblich", type: "expense" },
];
