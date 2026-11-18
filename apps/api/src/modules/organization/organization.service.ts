import { Injectable } from "@nestjs/common";
import type { AuditEntry, OrganizationDetails } from "@hv/contracts";
import { found, TenantDb } from "../../common/tenant-db.js";

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
}
