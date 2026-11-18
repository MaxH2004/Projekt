import type { PoolClient } from "pg";

/** A table whose rows carry a `valid` date range and must not overlap per key. */
export interface VersionedTable {
  readonly table: "unit_area" | "rent_component" | "tenancy_occupants";
  /** Columns identifying the thing being versioned, e.g. the unit. */
  readonly key: Readonly<Record<string, string>>;
  /** Column holding the versioned value. */
  readonly valueColumn: string;
}

/**
 * Sets the value that applies from `validFrom` on, inside the caller's tenant
 * transaction. The version covering that day is cut off the day before; the
 * new value runs until the next later version, or open-ended. Setting a value
 * for the day a version starts replaces that version's value (a correction).
 *
 * Table and column names come from code, never from user input.
 */
export async function setValueFrom(
  client: PoolClient,
  tenantId: string,
  target: VersionedTable,
  value: string | number,
  validFrom: string,
): Promise<void> {
  const keyColumns = Object.keys(target.key);
  const keyValues = Object.values(target.key);
  const where = keyColumns.map((column, i) => `${column} = $${i + 1}`).join(" AND ");
  const next = keyValues.length + 1;

  const covering = (
    await client.query<{ id: string; starts_same_day: boolean }>(
      `SELECT id, lower(valid) = $${next}::date AS starts_same_day
       FROM ${target.table} WHERE ${where} AND valid @> $${next}::date FOR UPDATE`,
      [...keyValues, validFrom],
    )
  ).rows[0];

  if (covering?.starts_same_day) {
    await client.query(`UPDATE ${target.table} SET ${target.valueColumn} = $1 WHERE id = $2`, [value, covering.id]);
    return;
  }

  // End of the new version: where the covering one ended, else where the next one starts.
  const until = (
    await client.query<{ until: string | null }>(
      `SELECT min(bound)::text AS until FROM (
         SELECT upper(valid) AS bound FROM ${target.table} WHERE ${where} AND valid @> $${next}::date
         UNION ALL
         SELECT lower(valid) FROM ${target.table} WHERE ${where} AND lower(valid) > $${next}::date
       ) bounds`,
      [...keyValues, validFrom],
    )
  ).rows[0]!.until;

  if (covering) {
    await client.query(`UPDATE ${target.table} SET valid = daterange(lower(valid), $1::date) WHERE id = $2`, [validFrom, covering.id]);
  }
  const columns = ["tenant_id", ...keyColumns, target.valueColumn, "valid"];
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  placeholders[placeholders.length - 1] = `daterange($${columns.length}::date, $${columns.length + 1}::date)`;
  await client.query(`INSERT INTO ${target.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`, [
    tenantId,
    ...keyValues,
    value,
    validFrom,
    until,
  ]);
}
