import { z } from "zod";

/** Removes spaces and upper-cases, as IBANs are often written in groups of four. */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/**
 * Checks an IBAN by its structure and its check digits (ISO 13616, mod 97).
 * German IBANs must have 22 characters.
 */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("DE") && iban.length !== 22) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export const ibanSchema = z.string().transform(normalizeIban).refine(isValidIban);

const optional = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullish();

/** Sender and bank details of the organization, printed on letters. */
export const organizationDetailsSchema = z.object({
  street: optional(200),
  postalCode: optional(20),
  city: optional(200),
  accountHolder: optional(200),
  iban: z.union([z.literal(""), ibanSchema]).transform((v) => v || null).nullish(),
});

export interface OrganizationDetails {
  readonly name: string;
  readonly street: string | null;
  readonly postalCode: string | null;
  readonly city: string | null;
  readonly accountHolder: string | null;
  /** Without spaces. */
  readonly iban: string | null;
}

/** IBAN in groups of four for printing. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.coerce.number().int().min(1).optional(),
});

/** One change to financial data. */
export interface AuditEntry {
  readonly id: number;
  readonly at: string;
  /** Null for changes made by background jobs or at registration. */
  readonly userId: string | null;
  readonly table: string;
  readonly rowId: string | null;
  readonly action: "insert" | "update" | "delete";
  readonly oldRow: Record<string, unknown> | null;
  readonly newRow: Record<string, unknown> | null;
}

// --- Documents ---

export const DOCUMENT_KINDS = ["receipt", "contract", "correspondence", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
/** Largest file accepted for upload. */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Query of an upload; the file itself is the raw request body. */
export const documentUploadQuerySchema = z
  .object({
    kind: z.enum(DOCUMENT_KINDS),
    fileName: z.string().trim().min(1).max(255),
    propertyId: z.uuid().optional(),
    tenancyId: z.uuid().optional(),
    expenseId: z.uuid().optional(),
  })
  .refine((q) => q.propertyId || q.tenancyId || q.expenseId, { path: ["propertyId"] });

export const documentListQuerySchema = z
  .object({
    propertyId: z.uuid().optional(),
    tenancyId: z.uuid().optional(),
    expenseId: z.uuid().optional(),
    /** "true": the receipts of all expenses. */
    receipts: z.literal("true").optional(),
  })
  .refine((q) => q.propertyId || q.tenancyId || q.expenseId || q.receipts, { path: ["propertyId"] });

export interface DocumentInfo {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
  readonly propertyId: string | null;
  readonly tenancyId: string | null;
  readonly expenseId: string | null;
  /** False for receipts of expenses, which are part of the books. */
  readonly deletable: boolean;
}
