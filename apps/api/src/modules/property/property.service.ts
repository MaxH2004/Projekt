import { Injectable } from "@nestjs/common";
import type { Building, Property, Unit, UnitAreaVersion } from "@hv/contracts";
import { setValueFrom } from "@hv/db";
import type pg from "pg";
import { found, TenantDb } from "../../common/tenant-db.js";

const PROPERTY = `id, name, ownership_form AS "ownershipForm"`;
const BUILDING = `id, property_id AS "propertyId", street, postal_code AS "postalCode", city`;
// The area valid today; versions are kept in unit_area.
const UNIT = `u.id, u.building_id AS "buildingId", u.label,
  (SELECT a.area_centi_sqm FROM unit_area a WHERE a.unit_id = u.id AND a.valid @> current_date) AS "areaCentiSqm"`;

@Injectable()
export class PropertyService {
  constructor(private readonly db: TenantDb) {}

  listProperties(tenantId: string): Promise<Property[]> {
    return this.db.run(tenantId, async (c) => (await c.query<Property>(`SELECT ${PROPERTY} FROM property ORDER BY name, id`)).rows);
  }

  createProperty(tenantId: string, input: { name: string }): Promise<Property> {
    return this.db.run(tenantId, async (c) =>
      (await c.query<Property>(`INSERT INTO property (tenant_id, name) VALUES ($1, $2) RETURNING ${PROPERTY}`, [tenantId, input.name])).rows[0]!,
    );
  }

  updateProperty(tenantId: string, id: string, input: { name: string }): Promise<Property> {
    return this.db.run(tenantId, async (c) =>
      found((await c.query<Property>(`UPDATE property SET name = $2 WHERE id = $1 RETURNING ${PROPERTY}`, [id, input.name])).rows[0]),
    );
  }

  deleteProperty(tenantId: string, id: string): Promise<void> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("DELETE FROM property WHERE id = $1 RETURNING id", [id])).rows[0]);
    });
  }

  listBuildings(tenantId: string, propertyId: string): Promise<Building[]> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("SELECT 1 FROM property WHERE id = $1", [propertyId])).rows[0]);
      return (await c.query<Building>(`SELECT ${BUILDING} FROM building WHERE property_id = $1 ORDER BY street, id`, [propertyId])).rows;
    });
  }

  createBuilding(tenantId: string, propertyId: string, input: { street: string; postalCode: string; city: string }): Promise<Building> {
    return this.db.run(tenantId, async (c) =>
      (
        await c.query<Building>(
          `INSERT INTO building (tenant_id, property_id, street, postal_code, city) VALUES ($1, $2, $3, $4, $5) RETURNING ${BUILDING}`,
          [tenantId, propertyId, input.street, input.postalCode, input.city],
        )
      ).rows[0]!,
    );
  }

  updateBuilding(tenantId: string, id: string, input: { street: string; postalCode: string; city: string }): Promise<Building> {
    return this.db.run(tenantId, async (c) =>
      found(
        (
          await c.query<Building>(`UPDATE building SET street = $2, postal_code = $3, city = $4 WHERE id = $1 RETURNING ${BUILDING}`, [
            id,
            input.street,
            input.postalCode,
            input.city,
          ])
        ).rows[0],
      ),
    );
  }

  deleteBuilding(tenantId: string, id: string): Promise<void> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("DELETE FROM building WHERE id = $1 RETURNING id", [id])).rows[0]);
    });
  }

  listUnits(tenantId: string, buildingId: string): Promise<Unit[]> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("SELECT 1 FROM building WHERE id = $1", [buildingId])).rows[0]);
      return (await c.query<Unit>(`SELECT ${UNIT} FROM unit u WHERE u.building_id = $1 ORDER BY u.label, u.id`, [buildingId])).rows;
    });
  }

  createUnit(tenantId: string, buildingId: string, input: { label: string; area?: { areaCentiSqm: number; validFrom: string } }): Promise<Unit> {
    return this.db.run(tenantId, async (c) => {
      const id = (await c.query<{ id: string }>("INSERT INTO unit (tenant_id, building_id, label) VALUES ($1, $2, $3) RETURNING id", [tenantId, buildingId, input.label]))
        .rows[0]!.id;
      if (input.area) await this.writeArea(c, tenantId, id, input.area);
      return this.readUnit(c, id);
    });
  }

  updateUnit(tenantId: string, id: string, input: { label: string }): Promise<Unit> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("UPDATE unit SET label = $2 WHERE id = $1 RETURNING id", [id, input.label])).rows[0]);
      return this.readUnit(c, id);
    });
  }

  /** Deletes the unit with its area history. Fails with `conflict` while tenancies or meters refer to it. */
  deleteUnit(tenantId: string, id: string): Promise<void> {
    return this.db.run(tenantId, async (c) => {
      await c.query("DELETE FROM unit_area WHERE unit_id = $1", [id]);
      found((await c.query("DELETE FROM unit WHERE id = $1 RETURNING id", [id])).rows[0]);
    });
  }

  setUnitArea(tenantId: string, unitId: string, input: { areaCentiSqm: number; validFrom: string }): Promise<UnitAreaVersion[]> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("SELECT 1 FROM unit WHERE id = $1 FOR UPDATE", [unitId])).rows[0]);
      await this.writeArea(c, tenantId, unitId, input);
      return this.readAreas(c, unitId);
    });
  }

  listUnitAreas(tenantId: string, unitId: string): Promise<UnitAreaVersion[]> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("SELECT 1 FROM unit WHERE id = $1", [unitId])).rows[0]);
      return this.readAreas(c, unitId);
    });
  }

  private writeArea(c: pg.PoolClient, tenantId: string, unitId: string, area: { areaCentiSqm: number; validFrom: string }): Promise<void> {
    return setValueFrom(c, tenantId, { table: "unit_area", key: { unit_id: unitId }, valueColumn: "area_centi_sqm" }, area.areaCentiSqm, area.validFrom);
  }

  private async readUnit(c: pg.PoolClient, id: string): Promise<Unit> {
    return found((await c.query<Unit>(`SELECT ${UNIT} FROM unit u WHERE u.id = $1`, [id])).rows[0]);
  }

  private async readAreas(c: pg.PoolClient, unitId: string): Promise<UnitAreaVersion[]> {
    return (
      await c.query<UnitAreaVersion>(
        `SELECT area_centi_sqm AS "areaCentiSqm", lower(valid)::text AS "validFrom", (upper(valid) - 1)::text AS "validTo"
         FROM unit_area WHERE unit_id = $1 ORDER BY lower(valid)`,
        [unitId],
      )
    ).rows;
  }
}
