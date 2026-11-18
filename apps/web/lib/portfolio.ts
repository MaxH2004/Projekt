import type { Building, Person, Property, Tenancy, Unit } from "@hv/contracts";
import { apiGet } from "./api";
import { today } from "./money";

export interface UnitInfo extends Unit {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly building: Building;
}

export interface Portfolio {
  readonly properties: readonly Property[];
  readonly units: readonly UnitInfo[];
  readonly persons: readonly Person[];
  /** All tenancies, with the rent valid today. */
  readonly tenancies: readonly Tenancy[];
  unit(id: string): UnitInfo | undefined;
  person(id: string): Person | undefined;
  tenancy(id: string): Tenancy | undefined;
  /** "Property · unit · tenants" for lists and selections. */
  tenancyLabel(id: string): string;
}

export function personName(p: Person): string {
  return p.kind === "legal" ? (p.companyName ?? "") : [p.givenName, p.familyName].filter(Boolean).join(" ");
}

/**
 * Loads properties down to units, persons and tenancies. The number of calls
 * grows with the number of buildings, which is small for private landlords.
 */
export async function loadPortfolio(): Promise<Portfolio> {
  const [properties, persons, tenancies] = await Promise.all([
    apiGet<Property[]>("/properties"),
    apiGet<Person[]>("/persons"),
    apiGet<Tenancy[]>(`/tenancies?on=${today()}`),
  ]);
  const buildings = (await Promise.all(properties.map((p) => apiGet<Building[]>(`/properties/${p.id}/buildings`)))).flat();
  const units = (
    await Promise.all(
      buildings.map(async (b) => {
        const property = properties.find((p) => p.id === b.propertyId)!;
        return (await apiGet<Unit[]>(`/buildings/${b.id}/units`)).map((u) => ({ ...u, propertyId: property.id, propertyName: property.name, building: b }));
      }),
    )
  ).flat();

  const unitMap = new Map(units.map((u) => [u.id, u]));
  const personMap = new Map(persons.map((p) => [p.id, p]));
  const tenancyMap = new Map(tenancies.map((t) => [t.id, t]));
  return {
    properties,
    units,
    persons,
    tenancies,
    unit: (id) => unitMap.get(id),
    person: (id) => personMap.get(id),
    tenancy: (id) => tenancyMap.get(id),
    tenancyLabel: (id) => {
      const tenancy = tenancyMap.get(id);
      if (!tenancy) return id;
      const unit = unitMap.get(tenancy.unitId);
      const names = tenancy.personIds.map((pid) => personMap.get(pid)).filter((p): p is Person => !!p).map(personName).join(", ");
      return [unit?.propertyName, unit?.label, names].filter(Boolean).join(" · ");
    },
  };
}
