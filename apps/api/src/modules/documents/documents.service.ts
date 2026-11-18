import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DOCUMENT_MAX_BYTES, type DocumentInfo, type DocumentKind } from "@hv/contracts";
import { detectFileType, type FileStorage } from "@hv/integrations";
import { ApiError } from "../../common/api-error.js";
import { found, TenantDb } from "../../common/tenant-db.js";

export const FILE_STORAGE = Symbol("FILE_STORAGE");

export interface DocumentLinks {
  propertyId?: string;
  tenancyId?: string;
  expenseId?: string;
  /** Only documents attached to an expense. */
  receipts?: "true";
}

const COLUMNS = `id, kind, file_name AS "fileName", content_type AS "contentType", size_bytes AS "sizeBytes",
  uploaded_at::text AS "uploadedAt", property_id AS "propertyId", tenancy_id AS "tenancyId", expense_id AS "expenseId",
  expense_id IS NULL AS deletable`;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: TenantDb,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
  ) {}

  private requireStorage(): FileStorage {
    if (!this.storage) throw new ApiError("file_storage_unavailable");
    return this.storage;
  }

  /**
   * Stores the file, then records it. The type is detected from the content;
   * the name is kept for display only.
   */
  async upload(tenantId: string, input: { kind: DocumentKind; fileName: string } & Omit<DocumentLinks, "receipts">, bytes: Uint8Array): Promise<DocumentInfo> {
    const storage = this.requireStorage();
    if (bytes.length === 0) throw new ApiError("validation_failed", ["file"]);
    if (bytes.length > DOCUMENT_MAX_BYTES) throw new ApiError("file_too_large");
    const contentType = detectFileType(bytes);
    if (!contentType) throw new ApiError("file_type_not_accepted");

    const id = randomUUID();
    const key = `${tenantId}/${id}`;
    await storage.put(key, bytes);
    try {
      return await this.db.run(tenantId, async (c) =>
        found(
          (
            await c.query<DocumentInfo>(
              `INSERT INTO document (id, tenant_id, property_id, tenancy_id, expense_id, kind, file_name, content_type, size_bytes, sha256, storage_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLUMNS}`,
              [
                id,
                tenantId,
                input.propertyId ?? null,
                input.tenancyId ?? null,
                input.expenseId ?? null,
                input.kind,
                input.fileName,
                contentType,
                bytes.length,
                createHash("sha256").update(bytes).digest(),
                key,
              ],
            )
          ).rows[0],
        ),
      );
    } catch (err) {
      // Nothing recorded (e.g. a property of another organization): remove the file again.
      await storage.delete(key);
      throw err;
    }
  }

  list(tenantId: string, links: DocumentLinks): Promise<DocumentInfo[]> {
    return this.db.run(tenantId, async (c) =>
      (
        await c.query<DocumentInfo>(
          `SELECT ${COLUMNS} FROM document
           WHERE ($1::uuid IS NULL OR property_id = $1) AND ($2::uuid IS NULL OR tenancy_id = $2) AND ($3::uuid IS NULL OR expense_id = $3)
             AND (NOT $4 OR expense_id IS NOT NULL)
           ORDER BY uploaded_at DESC, id`,
          [links.propertyId ?? null, links.tenancyId ?? null, links.expenseId ?? null, links.receipts === "true"],
        )
      ).rows,
    );
  }

  async content(tenantId: string, id: string): Promise<{ info: DocumentInfo; bytes: Uint8Array }> {
    const storage = this.requireStorage();
    const row = await this.db.run(tenantId, async (c) =>
      found((await c.query<DocumentInfo & { key: string }>(`SELECT ${COLUMNS}, storage_key AS key FROM document WHERE id = $1`, [id])).rows[0]),
    );
    const bytes = await storage.get(row.key);
    if (!bytes) throw new ApiError("not_found");
    const { key: _key, ...info } = row;
    return { info, bytes };
  }

  /** Receipts of expenses cannot be deleted; the database refuses it. */
  async delete(tenantId: string, id: string): Promise<void> {
    const storage = this.requireStorage();
    const key = await this.db.run(tenantId, async (c) =>
      found((await c.query<{ key: string }>("DELETE FROM document WHERE id = $1 RETURNING storage_key AS key", [id])).rows[0]).key,
    );
    await storage.delete(key);
  }
}
