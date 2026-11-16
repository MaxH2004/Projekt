import type { IsoDate } from "../period.js";

/**
 * A rule set bundles the calculation rules that apply to settlement periods
 * starting on or after `validFrom`. Every settlement stores the id of the rule
 * set it used, so it stays reproducible when the law changes.
 */
export interface RuleSet {
  readonly id: string;
  readonly country: "DE";
  readonly validFrom: IsoDate;
}
