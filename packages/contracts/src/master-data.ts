import { z } from "zod";

export const idSchema = z.uuid();

/** Calendar date YYYY-MM-DD that exists (no 30 February). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

const text = (max = 200) => z.string().trim().min(1).max(max);
const optionalText = (max = 200) => z.string().trim().min(1).max(max).nullish();

/** Amount in cents as a JSON integer. */
export const centsSchema = z.number().int().min(0).max(100_000_000_000);

// --- Properties, buildings, units ---

export const propertyInputSchema = z.object({ name: text() });
export interface Property {
  readonly id: string;
  readonly name: string;
  readonly ownershipForm: "rental" | "weg";
}

export const buildingInputSchema = z.object({ street: text(), postalCode: text(20), city: text() });
export interface Building {
  readonly id: string;
  readonly propertyId: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

/** Area in hundredths of a square metre: 54.37 m2 = 5437. */
export const unitAreaInputSchema = z.object({ areaCentiSqm: z.number().int().min(1).max(100_000_000), validFrom: isoDateSchema });
export const unitInputSchema = z.object({ label: text(), area: unitAreaInputSchema.optional() });
export const unitPatchSchema = z.object({ label: text() });
export interface Unit {
  readonly id: string;
  readonly buildingId: string;
  readonly label: string;
  /** Area valid today, or null if none is recorded for today. */
  readonly areaCentiSqm: number | null;
}
export interface UnitAreaVersion {
  readonly areaCentiSqm: number;
  readonly validFrom: string;
  /** Last day this area applies; null = still valid. */
  readonly validTo: string | null;
}

// --- Persons and tenancies ---

const contact = { email: z.string().trim().toLowerCase().pipe(z.email().max(254)).nullish(), phone: optionalText(50) };
export const personInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("natural"), givenName: optionalText(), familyName: text(), ...contact }),
  z.object({ kind: z.literal("legal"), companyName: text(), ...contact }),
]);
export interface Person {
  readonly id: string;
  readonly kind: "natural" | "legal";
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly companyName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
}

export const RENT_COMPONENT_KINDS = ["base_rent", "operating_cost_advance", "heating_cost_advance"] as const;
export type RentComponentKind = (typeof RENT_COMPONENT_KINDS)[number];
export const RENT_TYPES = ["fixed", "graduated", "indexed"] as const;

export const tenancyInputSchema = z
  .object({
    unitId: idSchema,
    startDate: isoDateSchema,
    /** Last day of the tenancy; omit for an open-ended one. */
    endDate: isoDateSchema.nullish(),
    rentType: z.enum(RENT_TYPES).default("fixed"),
    personIds: z.array(idSchema).min(1).max(20),
    baseRentCents: centsSchema,
    operatingCostAdvanceCents: centsSchema.default(0),
    heatingCostAdvanceCents: centsSchema.default(0),
  })
  .refine((t) => !t.endDate || t.endDate >= t.startDate, { path: ["endDate"] })
  .refine((t) => new Set(t.personIds).size === t.personIds.length, { path: ["personIds"] });

export const tenancyEndSchema = z.object({ endDate: isoDateSchema });
export const rentChangeSchema = z.object({ kind: z.enum(RENT_COMPONENT_KINDS), amountCents: centsSchema, validFrom: isoDateSchema });

export interface Tenancy {
  readonly id: string;
  readonly unitId: string;
  readonly startDate: string;
  /** Last day of the tenancy; null = ongoing. */
  readonly endDate: string | null;
  readonly rentType: (typeof RENT_TYPES)[number];
  readonly personIds: readonly string[];
  /** Monthly amounts valid on the requested day; a component without an amount is missing. */
  readonly rent: Partial<Record<RentComponentKind, number>>;
}

// --- Meters ---

export const METER_KINDS = ["electricity", "gas", "water_cold", "water_hot", "heat", "other"] as const;
export const METER_MEASURES = ["kWh", "MWh", "m3", "units"] as const;

export const meterInputSchema = z
  .object({
    unitId: idSchema.nullish(),
    buildingId: idSchema.nullish(),
    kind: z.enum(METER_KINDS),
    measure: z.enum(METER_MEASURES),
    serialNumber: text(100),
  })
  .refine((m) => Boolean(m.unitId) !== Boolean(m.buildingId), { path: ["unitId"] });
export interface Meter {
  readonly id: string;
  readonly unitId: string | null;
  readonly buildingId: string | null;
  readonly kind: (typeof METER_KINDS)[number];
  readonly measure: (typeof METER_MEASURES)[number];
  readonly serialNumber: string;
}

/** Reading as a decimal string with up to three decimals, e.g. "1234.5". Never a float. */
export const meterReadingInputSchema = z.object({
  readingDate: isoDateSchema,
  value: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/),
});
export interface MeterReading {
  readonly id: string;
  readonly readingDate: string;
  readonly value: string;
}
