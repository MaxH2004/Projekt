"use server";

import type { Building, Person, Property, Tenancy, Unit } from "@hv/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "../../lib/api";
import { fields, formAction, InvalidInput, type FormState } from "../../lib/form";

export async function createProperty(previous: FormState, data: FormData): Promise<FormState> {
  let created: Property | undefined;
  const state = await formAction(previous, async () => {
    created = await api<Property>("POST", "/properties", { name: fields(data).text("name") });
  });
  if (!created) return state;
  redirect(`/properties/${created.id}`);
}

export async function renameProperty(id: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    await api("PATCH", `/properties/${id}`, { name: fields(data).text("name") });
    revalidatePath(`/properties/${id}`);
  });
}

export async function createBuilding(propertyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api<Building>("POST", `/properties/${propertyId}/buildings`, { street: f.text("street"), postalCode: f.text("postalCode"), city: f.text("city") });
    revalidatePath(`/properties/${propertyId}`);
  });
}

export async function createUnit(propertyId: string, buildingId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const label = f.text("label");
    const area = f.optionalText("area");
    let body: Record<string, unknown> = { label };
    if (area) {
      // Two decimals, read like an amount: "54,37" → 5437.
      const centiSqm = f.money("area");
      // Required with an area: a default of today would leave earlier settlement periods without one.
      body = { label, area: { areaCentiSqm: centiSqm, validFrom: f.text("areaValidFrom") } };
    }
    await api<Unit>("POST", `/buildings/${buildingId}/units`, body);
    revalidatePath(`/properties/${propertyId}`);
  });
}

export async function createPerson(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const kind = f.text("kind");
    const contact = { email: f.optionalText("email"), phone: f.optionalText("phone") };
    const body =
      kind === "legal"
        ? { kind, companyName: f.text("companyName"), ...contact }
        : { kind: "natural", givenName: f.optionalText("givenName"), familyName: f.text("familyName"), ...contact };
    await api<Person>("POST", "/persons", body);
    revalidatePath("/persons");
  });
}

export async function deletePerson(id: string, previous: FormState): Promise<FormState> {
  return formAction(previous, async () => {
    await api("DELETE", `/persons/${id}`);
    revalidatePath("/persons");
  });
}

export async function createTenancy(previous: FormState, data: FormData): Promise<FormState> {
  let created: Tenancy | undefined;
  const state = await formAction(previous, async () => {
    const f = fields(data);
    const personIds = f.all("personIds");
    if (personIds.length === 0) throw new InvalidInput(["personIds"]);
    created = await api<Tenancy>("POST", "/tenancies", {
      unitId: f.text("unitId"),
      startDate: f.text("startDate"),
      endDate: f.optionalText("endDate"),
      rentType: f.text("rentType"),
      personIds,
      baseRentCents: f.money("baseRentCents"),
      operatingCostAdvanceCents: f.optionalMoney("operatingCostAdvanceCents"),
      heatingCostAdvanceCents: f.optionalMoney("heatingCostAdvanceCents"),
    });
  });
  if (!created) return state;
  redirect(`/tenancies/${created.id}`);
}

export async function endTenancy(id: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    await api("POST", `/tenancies/${id}/end`, { endDate: fields(data).text("endDate") });
    revalidatePath(`/tenancies/${id}`);
  });
}

export async function changeRent(id: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api("PUT", `/tenancies/${id}/rent`, { kind: f.text("kind"), amountCents: f.money("amountCents"), validFrom: f.text("validFrom") });
    revalidatePath(`/tenancies/${id}`);
  });
}

export async function setUnitArea(unitId: string, propertyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api("PUT", `/units/${unitId}/area`, { areaCentiSqm: f.money("area"), validFrom: f.text("validFrom") });
    revalidatePath(`/properties/${propertyId}`);
  });
}

export async function renameUnit(unitId: string, propertyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    await api("PATCH", `/units/${unitId}`, { label: fields(data).text("label") });
    revalidatePath(`/properties/${propertyId}`);
  });
}

export async function updateBuilding(buildingId: string, propertyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api("PATCH", `/buildings/${buildingId}`, { street: f.text("street"), postalCode: f.text("postalCode"), city: f.text("city") });
    revalidatePath(`/properties/${propertyId}`);
  });
}

/** A meter of a unit (`unit:<id>`) or of a whole building (`building:<id>`). */
export async function createMeter(propertyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const [scope, id] = f.text("target").split(":");
    await api("POST", "/meters", {
      ...(scope === "unit" ? { unitId: id } : { buildingId: id }),
      kind: f.text("kind"),
      measure: f.text("measure"),
      serialNumber: f.text("serialNumber"),
    });
    revalidatePath(`/properties/${propertyId}`);
  });
}

export async function deleteMeter(meterId: string, propertyId: string, previous: FormState): Promise<FormState> {
  return formAction(previous, async () => {
    await api("DELETE", `/meters/${meterId}`);
    revalidatePath(`/properties/${propertyId}`);
  });
}

/** Readings are typed with a comma or a dot; the API takes a dot and up to three decimals. */
export async function addReading(meterId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const value = f.text("value").replace(/\s/g, "").replace(",", ".");
    if (!/^\d{1,11}(\.\d{1,3})?$/.test(value)) throw new InvalidInput(["value"]);
    await api("POST", `/meters/${meterId}/readings`, { readingDate: f.text("readingDate"), value });
    revalidatePath(`/meters/${meterId}`);
  });
}

export async function deleteReading(readingId: string, meterId: string, previous: FormState): Promise<FormState> {
  return formAction(previous, async () => {
    await api("DELETE", `/meter-readings/${readingId}`);
    revalidatePath(`/meters/${meterId}`);
  });
}

export async function updatePerson(id: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const kind = f.text("kind");
    const contact = { email: f.optionalText("email"), phone: f.optionalText("phone") };
    const body =
      kind === "legal"
        ? { kind, companyName: f.text("companyName"), ...contact }
        : { kind: "natural", givenName: f.optionalText("givenName"), familyName: f.text("familyName"), ...contact };
    await api("PUT", `/persons/${id}`, body);
    revalidatePath("/persons");
  });
}

export async function setDeposit(tenancyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const amount = f.optionalText("depositCents");
    await api("PUT", `/tenancies/${tenancyId}/deposit`, { depositCents: amount ? f.money("depositCents") : null, depositHeld: f.optionalText("depositHeld") });
    revalidatePath(`/tenancies/${tenancyId}`);
  });
}

export async function setOccupants(tenancyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const persons = Number(f.text("persons"));
    if (!Number.isInteger(persons) || persons < 0 || persons > 99) throw new InvalidInput(["persons"]);
    await api("PUT", `/tenancies/${tenancyId}/occupants`, { persons, validFrom: f.text("validFrom") });
    revalidatePath(`/tenancies/${tenancyId}`);
  });
}

export async function deleteTenancy(tenancyId: string, previous: FormState): Promise<FormState> {
  const state = await formAction(previous, async () => {
    await api("DELETE", `/tenancies/${tenancyId}`);
  });
  if (state.error) return state;
  redirect("/tenancies");
}
