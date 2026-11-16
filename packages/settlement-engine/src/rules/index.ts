import { toDayNumber, type IsoDate } from "../period.js";
import { DE_RULE_SETS } from "./de/index.js";
import type { RuleSet } from "./types.js";

export type { RuleSet } from "./types.js";

const ALL: readonly RuleSet[] = [...DE_RULE_SETS];

/** Returns the rule set in force at the start of the settlement period. */
export function resolveRuleSet(country: RuleSet["country"], periodStart: IsoDate): RuleSet {
  const day = toDayNumber(periodStart);
  const match = ALL.filter((r) => r.country === country && toDayNumber(r.validFrom) <= day).sort(
    (a, b) => toDayNumber(b.validFrom) - toDayNumber(a.validFrom),
  )[0];
  if (!match) throw new RangeError(`No rule set for ${country} from ${periodStart}`);
  return match;
}
