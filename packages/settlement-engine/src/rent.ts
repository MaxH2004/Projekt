import { allocate } from "./allocation.js";
import { addMonths, daysInclusive, fromDayNumber, overlapDays, toDayNumber, type Period } from "./period.js";

/** Rent component kinds are named by the caller; the engine only groups by them. */
type RentComponentKind = string;

/** One amount of a rent component with its validity; `to` is the last day, null = open. */
export interface ComponentVersion<K extends RentComponentKind = RentComponentKind> {
  readonly kind: K;
  readonly amountCents: bigint;
  readonly from: string;
  readonly to: string | null;
}

export interface MonthlyCharge<K extends RentComponentKind = RentComponentKind> {
  readonly kind: K;
  readonly amountCents: bigint;
  /** First day of the month, or the first day of the tenancy if it starts later. */
  readonly dueDate: string;
}

/** First and last day of a month given as YYYY-MM. */
export function monthPeriod(month: string): Period {
  const from = `${month}-01`;
  return { from, to: fromDayNumber(toDayNumber(addMonths(from, 1)) - 1) };
}

/**
 * The charges of one tenancy for one calendar month.
 *
 * A monthly amount applies in full when it is valid for the whole month.
 * Otherwise it is prorated by the days it applies in that month (start or end
 * of the tenancy, change of the amount) over the days of the calendar month.
 * Rounding goes through `allocate`, so the days a version applies and the
 * days it does not always add up to the monthly amount.
 */
export function monthlyCharges<K extends RentComponentKind>(
  month: string,
  tenancy: { from: string; to: string | null },
  versions: readonly ComponentVersion<K>[],
): MonthlyCharge<K>[] {
  const period = monthPeriod(month);
  const monthDays = daysInclusive(period);
  if (overlapDays(period, tenancy) === 0) return [];
  const dueDate = tenancy.from > period.from ? tenancy.from : period.from;

  const totals = new Map<K, bigint>();
  for (const v of versions) {
    const from = v.from > tenancy.from ? v.from : tenancy.from;
    const to = v.to === null ? tenancy.to : tenancy.to === null || v.to < tenancy.to ? v.to : tenancy.to;
    if (to !== null && to < from) continue;
    const days = overlapDays(period, { from, to });
    if (days === 0 || v.amountCents === 0n) continue;
    const amount = days === monthDays ? v.amountCents : allocate(v.amountCents, [BigInt(days), BigInt(monthDays - days)])[0]!;
    totals.set(v.kind, (totals.get(v.kind) ?? 0n) + amount);
  }
  return [...totals]
    .filter(([, amount]) => amount > 0n)
    .map(([kind, amountCents]) => ({ kind, amountCents, dueDate }));
}
