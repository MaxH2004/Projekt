import type { MatchReason, MatchSuggestion } from "@hv/contracts";

export interface MatchTransaction {
  readonly amountCents: bigint;
  readonly counterpartyName: string | null;
  readonly counterpartyIban: string | null;
  readonly remittanceInfo: string;
}

export interface MatchCandidate {
  readonly tenancyId: string;
  /** Family names of natural persons and names of companies renting. */
  readonly partyNames: readonly string[];
  /** IBANs of earlier transactions booked to this tenancy. */
  readonly knownIbans: readonly string[];
  /** Amounts a tenant typically pays: the open amount per month, all open charges, the monthly rent. */
  readonly expectedAmounts: readonly bigint[];
}

/** Points per reason. A known IBAN outweighs the rest; amount and name only together come close. */
const WEIGHT: Record<MatchReason, number> = { known_iban: 4, amount_matches: 2, name_matches: 1 };
const MAX_SUGGESTIONS = 3;
/** Shorter names would match too many words of a remittance text. */
const MIN_NAME_LENGTH = 3;

/**
 * Ranks the tenancies an incoming transaction probably belongs to. This only
 * suggests; the user confirms before anything is booked.
 */
export function suggestTenancies(tx: MatchTransaction, candidates: readonly MatchCandidate[]): MatchSuggestion[] {
  if (tx.amountCents <= 0n) return [];
  const words = new Set(normalize(`${tx.counterpartyName ?? ""} ${tx.remittanceInfo}`).split(" ").filter(Boolean));

  return candidates
    .map((c) => {
      const reasons: MatchReason[] = [];
      if (tx.counterpartyIban && c.knownIbans.includes(tx.counterpartyIban)) reasons.push("known_iban");
      if (c.expectedAmounts.includes(tx.amountCents)) reasons.push("amount_matches");
      const nameMatches = c.partyNames.some((name) => {
        const parts = normalize(name).split(" ").filter((p) => p.length >= MIN_NAME_LENGTH);
        return parts.length > 0 && parts.every((p) => words.has(p));
      });
      if (nameMatches) reasons.push("name_matches");
      return { tenancyId: c.tenancyId, reasons, score: reasons.reduce((sum, r) => sum + WEIGHT[r], 0) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (a.tenancyId < b.tenancyId ? -1 : 1))
    .slice(0, MAX_SUGGESTIONS);
}

/** Lower case, umlauts spelled out as banks often do (Müller = Mueller), punctuation removed. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
