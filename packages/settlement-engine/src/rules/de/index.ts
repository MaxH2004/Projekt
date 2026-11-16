import type { RuleSet } from "../types.js";

/**
 * Rule sets for Germany. The first entry is only the technical starting point:
 * the domain rules (BetrKV, HeizkostenV, CO2KostAufG) are added once reviewed
 * test cases exist in `fixtures/`.
 */
export const DE_RULE_SETS: readonly RuleSet[] = [{ id: "de-2024-01", country: "DE", validFrom: "2024-01-01" }];
