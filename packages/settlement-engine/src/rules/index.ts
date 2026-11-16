import { toDayNumber, type IsoDate } from "../period.js";
import { DE_RULE_SETS } from "./de/index.js";
import type { RuleSet } from "./types.js";

export type { RuleSet } from "./types.js";

const ALL: readonly RuleSet[] = [...DE_RULE_SETS];

/** Liefert den Regelsatz, der am Beginn des Abrechnungszeitraums gilt. */
export function resolveRuleSet(country: RuleSet["country"], periodStart: IsoDate): RuleSet {
  const day = toDayNumber(periodStart);
  const match = ALL.filter((r) => r.country === country && toDayNumber(r.validFrom) <= day).sort(
    (a, b) => toDayNumber(b.validFrom) - toDayNumber(a.validFrom),
  )[0];
  if (!match) throw new RangeError(`Kein Regelsatz für ${country} ab ${periodStart}`);
  return match;
}
