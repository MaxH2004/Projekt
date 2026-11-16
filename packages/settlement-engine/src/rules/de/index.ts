import type { RuleSet } from "../types.js";

/**
 * Regelsätze für Deutschland. Der erste Eintrag ist nur der technische
 * Startpunkt: Die fachlichen Regeln (BetrKV, HeizkostenV, CO2KostAufG)
 * kommen erst dazu, wenn geprüfte Testfälle in `fixtures/` liegen.
 */
export const DE_RULE_SETS: readonly RuleSet[] = [{ id: "de-2024-01", country: "DE", validFrom: "2024-01-01" }];
