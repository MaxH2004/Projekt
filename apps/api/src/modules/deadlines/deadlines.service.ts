import { Injectable } from "@nestjs/common";
import type { Deadline, RentComponentKind } from "@hv/contracts";
import { addMonths } from "@hv/settlement-engine";
import { TenantDb } from "../../common/tenant-db.js";

/** How far ahead tenancy ends and rent changes are listed. */
const HORIZON_DAYS = 180;
/** How many past calendar years are checked for a missing settlement. */
const SETTLEMENT_YEARS = 2;

@Injectable()
export class DeadlinesService {
  constructor(private readonly db: TenantDb) {}

  /**
   * Dates that follow from the data: settlements not yet made for the last
   * calendar years (deadline as in the settlement engine), tenancies ending
   * and rent changes starting within the horizon. Sorted by date.
   */
  list(tenantId: string, today: string): Promise<Deadline[]> {
    return this.db.run(tenantId, async (c) => {
      const deadlines: Deadline[] = [];
      const year = Number(today.slice(0, 4));
      for (let y = year - SETTLEMENT_YEARS; y < year; y++) {
        const from = `${y}-01-01`;
        const to = `${y}-12-31`;
        const open = (
          await c.query<{ id: string }>(
            `SELECT DISTINCT b.property_id AS id FROM tenancy t JOIN unit u ON u.id = t.unit_id JOIN building b ON b.id = u.building_id
             WHERE t.term && daterange($1::date, $2::date, '[]')
               AND NOT EXISTS (SELECT FROM settlement s WHERE s.property_id = b.property_id AND s.cancelled_at IS NULL
                               AND s.period && daterange($1::date, $2::date, '[]'))`,
            [from, to],
          )
        ).rows;
        // The statement must reach the tenants within twelve months after the period (see the engine).
        for (const p of open) deadlines.push({ kind: "settlement_due", date: addMonths(to, 12), propertyId: p.id, year: y });
      }

      const ends = (
        await c.query<{ id: string; date: string }>(
          `SELECT id, (upper(term) - 1)::text AS date FROM tenancy
           WHERE upper(term) IS NOT NULL AND upper(term) - 1 BETWEEN $1::date AND $1::date + $2::int`,
          [today, HORIZON_DAYS],
        )
      ).rows;
      for (const e of ends) deadlines.push({ kind: "tenancy_end", date: e.date, tenancyId: e.id });

      const changes = (
        await c.query<{ tenancyId: string; component: RentComponentKind; amount: string; date: string }>(
          `SELECT r.tenancy_id AS "tenancyId", r.kind AS component, r.amount_cents::text AS amount, lower(r.valid)::text AS date
           FROM rent_component r JOIN tenancy t ON t.id = r.tenancy_id
           WHERE lower(r.valid) > $1::date AND lower(r.valid) <= $1::date + $2::int AND lower(r.valid) > lower(t.term)`,
          [today, HORIZON_DAYS],
        )
      ).rows;
      for (const ch of changes) deadlines.push({ kind: "rent_change", date: ch.date, tenancyId: ch.tenancyId, component: ch.component, amountCents: Number(ch.amount) });

      return deadlines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    });
  }
}
