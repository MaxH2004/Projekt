/** Calendar date without time, formatted YYYY-MM-DD. */
export type IsoDate = string;

/** Period with both bounds included. */
export interface Period {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

const MS_PER_DAY = 86_400_000;

/** Day number since 1970-01-01 (UTC). Throws on an invalid date. */
export function toDayNumber(date: IsoDate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Invalid date: ${date}`);
  }
  return ms / MS_PER_DAY;
}

export function daysInclusive(period: Period): number {
  const days = toDayNumber(period.to) - toDayNumber(period.from) + 1;
  if (days < 1) throw new RangeError(`Period ends before it starts: ${period.from} – ${period.to}`);
  return days;
}

/** Number of shared days; `to: null` means open-ended. */
export function overlapDays(a: Period, b: { from: IsoDate; to: IsoDate | null }): number {
  const start = Math.max(toDayNumber(a.from), toDayNumber(b.from));
  const end = Math.min(toDayNumber(a.to), b.to === null ? Infinity : toDayNumber(b.to));
  return Math.max(0, end - start + 1);
}
