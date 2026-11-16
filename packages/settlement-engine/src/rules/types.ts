import type { IsoDate } from "../period.js";

/**
 * Ein Regelsatz bündelt die Rechenregeln, die für Abrechnungszeiträume ab
 * `validFrom` gelten. Jede Abrechnung speichert die Kennung des verwendeten
 * Regelsatzes und bleibt damit nachrechenbar, auch wenn sich das Recht ändert.
 */
export interface RuleSet {
  readonly id: string;
  readonly country: "DE";
  readonly validFrom: IsoDate;
}
