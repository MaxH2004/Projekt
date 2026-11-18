import { OPERATING_COST_CATEGORY_KEYS, SETTLEMENT_KEYS, type SettlementConfig, type SettlementKey } from "@hv/contracts";

export type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, name: string) => {
  const value = params[name];
  return typeof value === "string" ? value : undefined;
};

/** Months YYYY-MM from the query, as the first and last day of the period. */
export function periodFromQuery(params: SearchParams): { propertyId: string; from: string; to: string; fromMonth: string; toMonth: string } | null {
  const propertyId = one(params, "propertyId");
  const fromMonth = one(params, "from");
  const toMonth = one(params, "to");
  if (!propertyId || !fromMonth || !toMonth || !/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth)) return null;
  const [y, m] = toMonth.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { propertyId, from: `${fromMonth}-01`, to: last, fromMonth, toMonth };
}

/**
 * The user's choices as query parameters: key_<category>, unit_<category>,
 * persons_<tenancyId>, vacancyPersons. Kept in the URL so a preview needs no
 * stored state and can be reloaded.
 */
export function configFromQuery(params: SearchParams, period: { propertyId: string; from: string; to: string }): SettlementConfig {
  const keys: SettlementConfig["keys"] = {};
  for (const category of OPERATING_COST_CATEGORY_KEYS) {
    const key = one(params, `key_${category}`);
    if (key && (SETTLEMENT_KEYS as readonly string[]).includes(key)) {
      keys[category] = { key: key as SettlementKey, directUnitId: one(params, `unit_${category}`) || null };
    }
  }
  const personsByTenancy: Record<string, number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (name.startsWith("persons_") && typeof value === "string" && /^\d{1,2}$/.test(value)) personsByTenancy[name.slice("persons_".length)] = Number(value);
  }
  const vacancy = one(params, "vacancyPersons");
  return {
    ...period,
    keys,
    personsByTenancy,
    vacancyPersons: vacancy && /^\d{1,2}$/.test(vacancy) ? Number(vacancy) : null,
  };
}
