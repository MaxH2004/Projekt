import { Injectable } from "@nestjs/common";
import type { Meter, MeterReading } from "@hv/contracts";
import { ApiError } from "../../common/api-error.js";
import { found, TenantDb } from "../../common/tenant-db.js";

const METER = `id, unit_id AS "unitId", building_id AS "buildingId", kind, measure, serial_number AS "serialNumber"`;
// trim_scale drops trailing zeros, so "1234.500" is reported as "1234.5".
const READING = `id, reading_date::text AS "readingDate", trim_scale(value)::text AS value`;

export interface MeterInput {
  unitId?: string | null;
  buildingId?: string | null;
  kind: Meter["kind"];
  measure: Meter["measure"];
  serialNumber: string;
}

@Injectable()
export class MeteringService {
  constructor(private readonly db: TenantDb) {}

  listMeters(tenantId: string, filter: { unitId?: string; buildingId?: string }): Promise<Meter[]> {
    return this.db.run(tenantId, async (c) =>
      (
        await c.query<Meter>(
          `SELECT ${METER} FROM meter
           WHERE ($1::uuid IS NULL OR unit_id = $1) AND ($2::uuid IS NULL OR building_id = $2)
           ORDER BY kind, serial_number, id`,
          [filter.unitId ?? null, filter.buildingId ?? null],
        )
      ).rows,
    );
  }

  createMeter(tenantId: string, input: MeterInput): Promise<Meter> {
    return this.db.run(tenantId, async (c) =>
      (
        await c.query<Meter>(
          `INSERT INTO meter (tenant_id, unit_id, building_id, kind, measure, serial_number)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${METER}`,
          [tenantId, input.unitId ?? null, input.buildingId ?? null, input.kind, input.measure, input.serialNumber],
        )
      ).rows[0]!,
    );
  }

  /** Deletes the meter with its readings. */
  deleteMeter(tenantId: string, id: string): Promise<void> {
    return this.db.run(tenantId, async (c) => {
      await c.query("DELETE FROM meter_reading WHERE meter_id = $1", [id]);
      found((await c.query("DELETE FROM meter WHERE id = $1 RETURNING id", [id])).rows[0]);
    });
  }

  listReadings(tenantId: string, meterId: string): Promise<MeterReading[]> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("SELECT 1 FROM meter WHERE id = $1", [meterId])).rows[0]);
      return (await c.query<MeterReading>(`SELECT ${READING} FROM meter_reading WHERE meter_id = $1 ORDER BY reading_date`, [meterId])).rows;
    });
  }

  /** One reading per meter and day; a second one for the same day is a `conflict`. */
  addReading(tenantId: string, meterId: string, input: { readingDate: string; value: string }): Promise<MeterReading> {
    return this.db.run(tenantId, async (c) => {
      // Checked first: the one-per-day constraint looks across tenants. The lock
      // keeps two readings of the same meter from passing the check together.
      found((await c.query("SELECT 1 FROM meter WHERE id = $1 FOR UPDATE", [meterId])).rows[0]);
      // A meter only counts up: a reading lies between the one before and the one after.
      // A replaced meter is a new meter.
      const { implausible } = (
        await c.query<{ implausible: boolean }>(
          `SELECT EXISTS (SELECT FROM meter_reading WHERE meter_id = $1 AND reading_date < $2 AND value > $3::numeric)
               OR EXISTS (SELECT FROM meter_reading WHERE meter_id = $1 AND reading_date > $2 AND value < $3::numeric) AS implausible`,
          [meterId, input.readingDate, input.value],
        )
      ).rows[0]!;
      if (implausible) throw new ApiError("reading_not_plausible", ["value"]);
      return (
        await c.query<MeterReading>(
          `INSERT INTO meter_reading (tenant_id, meter_id, reading_date, value) VALUES ($1, $2, $3, $4::numeric) RETURNING ${READING}`,
          [tenantId, meterId, input.readingDate, input.value],
        )
      ).rows[0]!;
    });
  }

  deleteReading(tenantId: string, id: string): Promise<void> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("DELETE FROM meter_reading WHERE id = $1 RETURNING id", [id])).rows[0]);
    });
  }
}
