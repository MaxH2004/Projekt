export interface ChartAccount {
  /** Six digits: the four-digit SKR 04 account plus the two-digit sub-account of the rental variant. */
  readonly code: string;
  /** Our own short description. Not the publisher's wording, see docs/domain-rules/chart-of-accounts.md. */
  readonly name: string;
  readonly type: "asset" | "liability" | "equity" | "income" | "expense";
}

/**
 * Accounts for private landlords, numbered as in the DATEV chart
 * "SKR 04 Vermietung und Verpachtung", edition valid for 2026.
 * Every number was checked against that edition. Add accounts only after
 * checking them against the current edition, never from memory.
 */
export const SKR04_RENTAL_2026: readonly ChartAccount[] = [
  // Class 1: current assets
  { code: "120000", name: "Receivables from tenants", type: "asset" },
  { code: "135000", name: "Deposits paid", type: "asset" },
  { code: "137010", name: "Condominium fees in transit", type: "asset" },
  { code: "160000", name: "Cash", type: "asset" },
  { code: "180000", name: "Bank", type: "asset" },
  // Class 2: private accounts
  { code: "210000", name: "Private withdrawals", type: "equity" },
  { code: "218000", name: "Private contributions", type: "equity" },
  // Class 3: liabilities
  { code: "330000", name: "Payables to suppliers", type: "liability" },
  { code: "350000", name: "Other liabilities", type: "liability" },
  { code: "355000", name: "Tenant deposits received", type: "liability" },
  // Class 4: rental income
  { code: "400300", name: "Rent for earlier years and offset deposits", type: "income" },
  { code: "410500", name: "Rent for apartments, without allocated costs", type: "income" },
  { code: "410600", name: "Rent for other rooms, without allocated costs", type: "income" },
  { code: "410690", name: "Rent for garages, VAT-exempt", type: "income" },
  { code: "410800", name: "Advance payments for operating costs, VAT-exempt letting", type: "income" },
  { code: "410850", name: "Settlement payments and refunds for operating costs, VAT-exempt letting", type: "income" },
  // Classes 6 and 7: expenses, each the fully deductible account
  { code: "622100", name: "Depreciation of buildings", type: "expense" },
  { code: "630300", name: "Caretaker", type: "expense" },
  { code: "632000", name: "Heating", type: "expense" },
  { code: "632100", name: "Hot water", type: "expense" },
  { code: "632200", name: "Chimney cleaning", type: "expense" },
  { code: "632500", name: "Gas, electricity, water", type: "expense" },
  { code: "632600", name: "Gas", type: "expense" },
  { code: "632700", name: "Lighting of common areas", type: "expense" },
  { code: "632800", name: "Water supply", type: "expense" },
  { code: "633000", name: "Staircase cleaning", type: "expense" },
  { code: "640000", name: "Building insurance", type: "expense" },
  { code: "643000", name: "Other public charges", type: "expense" },
  { code: "643100", name: "Street cleaning", type: "expense" },
  { code: "643200", name: "Drainage", type: "expense" },
  { code: "645000", name: "Maintenance, fully deductible, directly assigned", type: "expense" },
  { code: "647000", name: "Lift", type: "expense" },
  { code: "685100", name: "Cable fee", type: "expense" },
  { code: "685500", name: "Bank charges", type: "expense" },
  { code: "685900", name: "Waste collection", type: "expense" },
  { code: "699200", name: "Administration costs", type: "expense" },
  { code: "730000", name: "Loan interest", type: "expense" },
  { code: "768000", name: "Property tax", type: "expense" },
];
