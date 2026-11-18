import type { OrganizationDetails } from "@hv/contracts";
import { apiGet } from "./api";
import { personName, type Portfolio } from "./portfolio";

/** Sender block for letters from the organization's details. */
export async function loadSender(): Promise<{ senderName: string; senderAddress: string[]; iban: string | null }> {
  const d = await apiGet<OrganizationDetails>("/organization/details");
  const cityLine = [d.postalCode, d.city].filter(Boolean).join(" ");
  return { senderName: d.name, senderAddress: [d.street ?? "", cityLine].filter(Boolean), iban: d.iban };
}

/** The tenants of a tenancy and their address, which is the let unit's building. */
export function recipientOf(portfolio: Portfolio, tenancyId: string): { names: string; address: string[]; unitLabel: string } {
  const tenancy = portfolio.tenancy(tenancyId);
  const unit = tenancy ? portfolio.unit(tenancy.unitId) : undefined;
  const names = (tenancy?.personIds ?? [])
    .map((pid) => portfolio.person(pid))
    .filter((p) => p !== undefined)
    .map(personName)
    .join(", ");
  const building = unit?.building;
  return {
    names,
    address: [names, ...(building ? [building.street, `${building.postalCode} ${building.city}`] : [])],
    unitLabel: unit ? `${building ? building.street : unit.propertyName}, ${unit.label}` : "",
  };
}

/** Headers for a letter page: our own HTML, no scripts, nothing loaded from elsewhere. */
export const LETTER_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
};
