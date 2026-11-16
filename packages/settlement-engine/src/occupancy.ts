import { allocate } from "./allocation.js";
import { daysInclusive, overlapDays, toDayNumber, type IsoDate, type Period } from "./period.js";

export interface Occupancy {
  readonly id: string;
  readonly from: IsoDate;
  /** `null` = Mietverhältnis läuft weiter. */
  readonly to: IsoDate | null;
}

export interface OccupancySplit {
  readonly shares: readonly { id: string; days: number; amountCents: bigint }[];
  /** Leerstand: diesen Anteil trägt der Vermieter. */
  readonly vacancy: { days: number; amountCents: bigint };
}

/**
 * Teilt die Kosten einer Einheit tagesgenau auf die Mietverhältnisse im
 * Abrechnungszeitraum auf. Tage ohne Mietverhältnis sind Leerstand.
 */
export function splitByOccupancy(
  totalCents: bigint,
  period: Period,
  occupancies: readonly Occupancy[],
): OccupancySplit {
  const totalDays = daysInclusive(period);

  const sorted = [...occupancies].sort((a, b) => toDayNumber(a.from) - toDayNumber(b.from));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.to === null || toDayNumber(prev.to) >= toDayNumber(cur.from)) {
      throw new RangeError(`Mietverhältnisse ${prev.id} und ${cur.id} überschneiden sich`);
    }
  }

  const days = occupancies.map((o) => overlapDays(period, o));
  const occupiedDays = days.reduce((a, b) => a + b, 0);
  const vacancyDays = totalDays - occupiedDays;

  const amounts = allocate(totalCents, [...days.map(BigInt), BigInt(vacancyDays)]);
  return {
    shares: occupancies.map((o, i) => ({ id: o.id, days: days[i]!, amountCents: amounts[i]! })),
    vacancy: { days: vacancyDays, amountCents: amounts[amounts.length - 1]! },
  };
}
