import { Injectable } from "@nestjs/common";
import type { Person, RentComponentKind, Tenancy } from "@hv/contracts";
import { setValueFrom } from "@hv/db";
import type pg from "pg";
import { ApiError } from "../../common/api-error.js";
import { found, TenantDb } from "../../common/tenant-db.js";

const PERSON = `id, kind, given_name AS "givenName", family_name AS "familyName", company_name AS "companyName", email, phone`;

export type PersonInput =
  | { kind: "natural"; givenName?: string | null; familyName: string; email?: string | null; phone?: string | null }
  | { kind: "legal"; companyName: string; email?: string | null; phone?: string | null };

export interface TenancyInput {
  unitId: string;
  startDate: string;
  endDate?: string | null;
  rentType: Tenancy["rentType"];
  personIds: string[];
  baseRentCents: number;
  operatingCostAdvanceCents: number;
  heatingCostAdvanceCents: number;
}

const personColumns = (input: PersonInput) => [
  input.kind,
  input.kind === "natural" ? (input.givenName ?? null) : null,
  input.kind === "natural" ? input.familyName : null,
  input.kind === "legal" ? input.companyName : null,
  input.email ?? null,
  input.phone ?? null,
];

@Injectable()
export class TenancyService {
  constructor(private readonly db: TenantDb) {}

  listPersons(tenantId: string): Promise<Person[]> {
    return this.db.run(tenantId, async (c) =>
      (await c.query<Person>(`SELECT ${PERSON} FROM person ORDER BY coalesce(family_name, company_name), given_name, id`)).rows,
    );
  }

  createPerson(tenantId: string, input: PersonInput): Promise<Person> {
    return this.db.run(tenantId, async (c) =>
      (
        await c.query<Person>(
          `INSERT INTO person (tenant_id, kind, given_name, family_name, company_name, email, phone)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${PERSON}`,
          [tenantId, ...personColumns(input)],
        )
      ).rows[0]!,
    );
  }

  updatePerson(tenantId: string, id: string, input: PersonInput): Promise<Person> {
    return this.db.run(tenantId, async (c) =>
      found(
        (
          await c.query<Person>(
            `UPDATE person SET kind = $2, given_name = $3, family_name = $4, company_name = $5, email = $6, phone = $7
             WHERE id = $1 RETURNING ${PERSON}`,
            [id, ...personColumns(input)],
          )
        ).rows[0],
      ),
    );
  }

  deletePerson(tenantId: string, id: string): Promise<void> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("DELETE FROM person WHERE id = $1 RETURNING id", [id])).rows[0]);
    });
  }

  /** Creates the tenancy with its parties and the rent valid from the first day. */
  createTenancy(tenantId: string, input: TenancyInput): Promise<Tenancy> {
    return this.db.run(tenantId, async (c) => {
      // Checked first: the overlap constraint looks across tenants, so without
      // this a foreign unit id would answer `conflict` instead of `not_found`.
      found((await c.query("SELECT 1 FROM unit WHERE id = $1 FOR SHARE", [input.unitId])).rows[0]);
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO tenancy (tenant_id, unit_id, term, rent_type)
           VALUES ($1, $2, daterange($3::date, $4::date + 1), $5) RETURNING id`,
          [tenantId, input.unitId, input.startDate, input.endDate ?? null, input.rentType],
        )
      ).rows[0]!.id;
      for (const personId of input.personIds) {
        await c.query("INSERT INTO tenancy_party (tenant_id, tenancy_id, person_id) VALUES ($1, $2, $3)", [tenantId, id, personId]);
      }
      const components: [RentComponentKind, number][] = [
        ["base_rent", input.baseRentCents],
        ["operating_cost_advance", input.operatingCostAdvanceCents],
        ["heating_cost_advance", input.heatingCostAdvanceCents],
      ];
      for (const [kind, amount] of components) {
        if (kind === "base_rent" || amount > 0) await this.writeRent(c, tenantId, id, kind, amount, input.startDate);
      }
      return found((await this.read(c, "t.id = $2", [input.startDate, id]))[0]);
    });
  }

  /** Tenancies with the rent valid on `on`, optionally for one unit. */
  listTenancies(tenantId: string, on: string, unitId?: string): Promise<Tenancy[]> {
    return this.db.run(tenantId, (c) => (unitId ? this.read(c, "t.unit_id = $2", [on, unitId]) : this.read(c, "true", [on])));
  }

  /**
   * Sets the last day of the tenancy. Rent and occupant values after that day
   * are removed or cut off, so nothing remains dated beyond the tenancy.
   */
  endTenancy(tenantId: string, id: string, endDate: string): Promise<Tenancy> {
    return this.db.run(tenantId, async (c) => {
      const row = found((await c.query<{ before_start: boolean }>("SELECT $2::date < lower(term) AS before_start FROM tenancy WHERE id = $1 FOR UPDATE", [id, endDate])).rows[0]);
      if (row.before_start) throw new ApiError("validation_failed", ["endDate"]);
      await c.query("UPDATE tenancy SET term = daterange(lower(term), $2::date + 1) WHERE id = $1", [id, endDate]);
      for (const table of ["rent_component", "tenancy_occupants"]) {
        await c.query(`DELETE FROM ${table} WHERE tenancy_id = $1 AND lower(valid) > $2::date`, [id, endDate]);
        await c.query(
          `UPDATE ${table} SET valid = daterange(lower(valid), $2::date + 1)
           WHERE tenancy_id = $1 AND (upper(valid) IS NULL OR upper(valid) > $2::date + 1)`,
          [id, endDate],
        );
      }
      return found((await this.read(c, "t.id = $2", [endDate, id]))[0]);
    });
  }

  /**
   * Deletes a tenancy entered by mistake. Refused once anything refers to it:
   * charges, payments, documents, settlements.
   */
  deleteTenancy(tenantId: string, id: string): Promise<void> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("SELECT 1 FROM tenancy WHERE id = $1 FOR UPDATE", [id])).rows[0]);
      const { used } = (
        await c.query<{ used: boolean }>(
          `SELECT EXISTS (SELECT FROM rent_charge WHERE tenancy_id = $1) OR EXISTS (SELECT FROM payment WHERE tenancy_id = $1)
               OR EXISTS (SELECT FROM document WHERE tenancy_id = $1) OR EXISTS (SELECT FROM settlement_statement WHERE tenancy_id = $1)
               OR EXISTS (SELECT FROM credit_refund WHERE tenancy_id = $1) AS used`,
          [id],
        )
      ).rows[0]!;
      if (used) throw new ApiError("conflict");
      for (const table of ["tenancy_occupants", "rent_component", "tenancy_party"]) await c.query(`DELETE FROM ${table} WHERE tenancy_id = $1`, [id]);
      await c.query("DELETE FROM tenancy WHERE id = $1", [id]);
    });
  }

  setDeposit(tenantId: string, id: string, input: { depositCents: number | null; depositHeld?: string | null }): Promise<Tenancy> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("UPDATE tenancy SET deposit_cents = $2, deposit_held = $3 WHERE id = $1 RETURNING id", [id, input.depositCents, input.depositHeld ?? null])).rows[0]);
      return found((await this.read(c, "t.id = $2", [new Date().toISOString().slice(0, 10), id]))[0]);
    });
  }

  /** Number of people living in the unit from `validFrom` on. */
  setOccupants(tenantId: string, id: string, input: { persons: number; validFrom: string }): Promise<Tenancy> {
    return this.db.run(tenantId, async (c) => {
      const row = found((await c.query<{ inside: boolean }>("SELECT term @> $2::date AS inside FROM tenancy WHERE id = $1 FOR UPDATE", [id, input.validFrom])).rows[0]);
      if (!row.inside) throw new ApiError("validation_failed", ["validFrom"]);
      await setValueFrom(c, tenantId, { table: "tenancy_occupants", key: { tenancy_id: id }, valueColumn: "persons" }, input.persons, input.validFrom);
      return found((await this.read(c, "t.id = $2", [input.validFrom, id]))[0]);
    });
  }

  /** Changes one rent component from `validFrom` on; earlier amounts stay as they were. */
  changeRent(tenantId: string, id: string, change: { kind: RentComponentKind; amountCents: number; validFrom: string }): Promise<Tenancy> {
    return this.db.run(tenantId, async (c) => {
      const row = found((await c.query<{ inside: boolean }>("SELECT term @> $2::date AS inside FROM tenancy WHERE id = $1 FOR UPDATE", [id, change.validFrom])).rows[0]);
      if (!row.inside) throw new ApiError("validation_failed", ["validFrom"]);
      await this.writeRent(c, tenantId, id, change.kind, change.amountCents, change.validFrom);
      return found((await this.read(c, "t.id = $2", [change.validFrom, id]))[0]);
    });
  }

  private writeRent(c: pg.PoolClient, tenantId: string, tenancyId: string, kind: RentComponentKind, amountCents: number, validFrom: string): Promise<void> {
    return setValueFrom(c, tenantId, { table: "rent_component", key: { tenancy_id: tenancyId, kind }, valueColumn: "amount_cents" }, amountCents, validFrom);
  }

  /** `$1` is always the day whose rent is reported. */
  private async read(c: pg.PoolClient, where: string, params: unknown[]): Promise<Tenancy[]> {
    const rows = (
      await c.query<Omit<Tenancy, "rent"> & { rent: Record<string, string> | null }>(
        `SELECT t.id, t.unit_id AS "unitId", lower(t.term)::text AS "startDate", (upper(t.term) - 1)::text AS "endDate",
                t.rent_type AS "rentType",
                (SELECT coalesce(array_agg(p.person_id ORDER BY p.person_id), '{}') FROM tenancy_party p WHERE p.tenancy_id = t.id) AS "personIds",
                (SELECT jsonb_object_agg(r.kind, r.amount_cents::text) FROM rent_component r WHERE r.tenancy_id = t.id AND r.valid @> $1::date) AS rent,
                t.deposit_cents::int AS "depositCents", t.deposit_held AS "depositHeld",
                (SELECT o.persons FROM tenancy_occupants o WHERE o.tenancy_id = t.id AND o.valid @> $1::date) AS occupants
         FROM tenancy t WHERE ${where} ORDER BY lower(t.term), t.id`,
        params,
      )
    ).rows;
    return rows.map((row) => ({
      ...row,
      rent: Object.fromEntries(Object.entries(row.rent ?? {}).map(([kind, cents]) => [kind, Number(cents)])),
    }));
  }
}
