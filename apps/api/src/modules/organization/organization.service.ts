import { Injectable } from "@nestjs/common";
import type { AuditEntry, DataExport, OrganizationDetails } from "@hv/contracts";
import { found, TenantDb } from "../../common/tenant-db.js";

/**
 * Tables of an organization's data, in an order in which they can be read
 * back (parents before children). Identity tables (users, sessions) are not
 * organization data; the audit log is exported separately if ever needed.
 */
export const EXPORT_TABLES = [
  "organization_details", "account", "property", "building", "unit", "unit_area", "person", "tenancy", "tenancy_party",
  "rent_component", "tenancy_occupants", "meter", "meter_reading", "journal_entry", "journal_line", "rent_charge",
  "bank_account", "bank_transaction", "payment", "payment_allocation", "expense", "expense_line", "settlement",
  "settlement_statement", "credit_refund", "bank_booking", "document",
] as const;

export type OrganizationDetailsInput = Omit<{ [K in keyof OrganizationDetails]?: OrganizationDetails[K] | null }, "name">;

const SELECT = `SELECT o.name, d.street, d.postal_code AS "postalCode", d.city, d.account_holder AS "accountHolder", d.iban
  FROM organization o LEFT JOIN organization_details d ON d.tenant_id = o.id`;

@Injectable()
export class OrganizationService {
  constructor(private readonly db: TenantDb) {}

  details(tenantId: string): Promise<OrganizationDetails> {
    return this.db.run(tenantId, async (c) => found((await c.query<OrganizationDetails>(SELECT)).rows[0]));
  }

  /** Replaces all details; a field left out is cleared. */
  saveDetails(tenantId: string, input: OrganizationDetailsInput): Promise<OrganizationDetails> {
    return this.db.run(tenantId, async (c) => {
      await c.query(
        `INSERT INTO organization_details (tenant_id, street, postal_code, city, account_holder, iban)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id) DO UPDATE SET street = $2, postal_code = $3, city = $4, account_holder = $5, iban = $6, updated_at = now()`,
        [tenantId, input.street ?? null, input.postalCode ?? null, input.city ?? null, input.accountHolder ?? null, input.iban ?? null],
      );
      return found((await c.query<OrganizationDetails>(SELECT)).rows[0]);
    });
  }

  /** Newest changes first; `before` continues a page. */
  auditLog(tenantId: string, limit: number, before?: number): Promise<AuditEntry[]> {
    return this.db.run(tenantId, async (c) =>
      (
        await c.query<AuditEntry>(
          `SELECT id::int, at::text, user_id AS "userId", table_name AS "table", row_id AS "rowId", action,
                  old_row AS "oldRow", new_row AS "newRow"
           FROM audit_log WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2`,
          [before ?? null, limit],
        )
      ).rows,
    );
  }

  rename(tenantId: string, name: string): Promise<OrganizationDetails> {
    return this.db.run(tenantId, async (c) => {
      found((await c.query("UPDATE organization SET name = $2 WHERE id = $1 RETURNING id", [tenantId, name])).rows[0]);
      return found((await c.query<OrganizationDetails>(SELECT)).rows[0]);
    });
  }

  /**
   * All data of the organization, read in one transaction. Each table is read
   * with its own snapshot (read committed); a change made during the export
   * can show in later tables but not in earlier ones.
   */
  export(tenantId: string): Promise<DataExport> {
    return this.db.run(tenantId, async (c) => {
      const organization = found((await c.query<{ id: string; name: string }>("SELECT id, name FROM organization WHERE id = $1", [tenantId])).rows[0]);
      const tables: Record<string, Record<string, unknown>[]> = {};
      for (const table of EXPORT_TABLES) {
        // Row-level security limits every table to this organization. bytea comes as hex.
        tables[table] = (await c.query(`SELECT * FROM ${table} ORDER BY 1`)).rows.map((row: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString("hex") : v instanceof Date ? v.toISOString() : v])),
        );
      }
      return { format: "hv-export", version: 1, exportedAt: new Date().toISOString(), organization, tables };
    });
  }
}
