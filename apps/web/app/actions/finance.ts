"use server";

import type { Expense, RentCharge } from "@hv/contracts";
import { revalidatePath } from "next/cache";
import { api } from "../../lib/api";
import { fields, formAction, InvalidInput, type FormState } from "../../lib/form";
import { sendDocument } from "./documents";

export async function generateCharges(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    await api<RentCharge[]>("POST", "/charges/generate", { month: fields(data).text("month") });
    revalidatePath("/rent");
  });
}

export async function cancelCharge(id: string, tenancyId: string, previous: FormState): Promise<FormState> {
  return formAction(previous, async () => {
    await api("POST", `/charges/${id}/cancel`);
    revalidatePath(`/tenancies/${tenancyId}`);
  });
}

export async function recordPayment(tenancyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const amountCents = f.money("amountCents");
    // Charges ticked by the user are covered in the order shown, up to the amount;
    // without a tick the API covers the oldest charges first.
    const chosen = f.all("chargeIds");
    let allocations: { chargeId: string; amountCents: number }[] | undefined;
    if (chosen.length > 0) {
      const open = await api<RentCharge[]>("GET", `/charges?tenancyId=${tenancyId}&status=open`);
      let left = amountCents;
      allocations = [];
      for (const charge of open.filter((c) => chosen.includes(c.id))) {
        if (left === 0) break;
        const take = Math.min(charge.openCents, left);
        allocations.push({ chargeId: charge.id, amountCents: take });
        left -= take;
      }
    }
    await api("POST", "/payments", { tenancyId, receivedOn: f.text("receivedOn"), amountCents, reference: f.optionalText("reference"), allocations });
    revalidatePath(`/tenancies/${tenancyId}`);
  });
}

export async function applyCredit(tenancyId: string, previous: FormState): Promise<FormState> {
  return formAction(previous, async () => {
    await api("POST", `/tenancies/${tenancyId}/apply-credit`, { bookingDate: new Date().toISOString().slice(0, 10) });
    revalidatePath(`/tenancies/${tenancyId}`);
  });
}

/** An overpayment paid back, or a settlement credit when `settlementId` is given. */
export async function refundCredit(tenancyId: string, settlementId: string | null, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api("POST", `/tenancies/${tenancyId}/refunds`, settlementId
      ? { reason: "settlement", settlementId, paidOn: f.text("paidOn") }
      : { reason: "overpayment", amountCents: f.money("amountCents"), paidOn: f.text("paidOn") });
    revalidatePath(`/tenancies/${tenancyId}`);
    if (settlementId) revalidatePath(`/settlements/${settlementId}`);
  });
}

export async function reverseRefund(id: string, tenancyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    await api("POST", `/refunds/${id}/reverse`, { bookingDate: fields(data).text("bookingDate") });
    revalidatePath(`/tenancies/${tenancyId}`);
  });
}

export async function cancelSettlement(id: string, previous: FormState): Promise<FormState> {
  return formAction(previous, async () => {
    await api("POST", `/settlements/${id}/cancel`);
    revalidatePath(`/settlements/${id}`);
    revalidatePath("/settlements");
  });
}

export async function bookTransactionAsRefund(id: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    // One select carries both kinds: "overpayment:<tenancy>" or "settlement:<settlement>:<tenancy>".
    const [reason, first, second] = fields(data).text("refund").split(":");
    const body = reason === "settlement" ? { reason, settlementId: first, tenancyId: second } : { reason: "overpayment", tenancyId: first };
    await api("POST", `/bank-transactions/${id}/book-refund`, body);
    revalidatePath("/bank");
  });
}

export async function bookTransactionOther(id: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api("POST", `/bank-transactions/${id}/book-other`, {
      accountCode: f.text("accountCode"),
      propertyId: f.optionalText("propertyId"),
      description: f.optionalText("description"),
    });
    revalidatePath("/bank");
  });
}

export async function reversePayment(id: string, tenancyId: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    await api("POST", `/payments/${id}/reverse`, { bookingDate: fields(data).text("bookingDate") });
    revalidatePath(`/tenancies/${tenancyId}`);
  });
}

export async function importStatement(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const file = fields(data).file("file");
    if (file.size > 1_500_000) throw new InvalidInput(["file"]);
    await api("POST", "/bank-imports", { format: "camt053", content: await file.text() });
    revalidatePath("/bank");
  });
}

export async function bookTransaction(id: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    await api("POST", `/bank-transactions/${id}/book`, { tenancyId: fields(data).text("tenancyId") });
    revalidatePath("/bank");
  });
}

export async function bookTransactionAsExpense(id: string, amountCents: number, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    await api("POST", `/bank-transactions/${id}/book-expense`, {
      description: f.optionalText("description"),
      lines: [{ accountCode: f.text("accountCode"), propertyId: f.text("propertyId"), amountCents, operatingCostCategory: f.optionalText("operatingCostCategory") }],
    });
    revalidatePath("/bank");
  });
}

export async function setTransactionIgnored(id: string, ignored: boolean, previous: FormState): Promise<FormState> {
  return formAction(previous, async () => {
    await api("PUT", `/bank-transactions/${id}/ignored`, { ignored });
    revalidatePath("/bank");
  });
}

export async function recordExpense(previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const receipt = data.get("receipt");
    const file = receipt instanceof File && receipt.size > 0 ? receipt : null;
    if (file && file.size > 10 * 1024 * 1024) throw new InvalidInput(["receipt"]);
    // Lines are numbered from 0 without gaps (components/expense-lines.tsx).
    const lines = [];
    for (let i = 0; data.has(`accountCode_${i}`); i++) {
      lines.push({
        accountCode: f.text(`accountCode_${i}`),
        propertyId: f.text(`propertyId_${i}`),
        amountCents: f.money(`amount_${i}`),
        operatingCostCategory: f.optionalText(`category_${i}`),
      });
    }
    const expense = await api<Expense>("POST", "/expenses", {
      paidOn: f.text("paidOn"),
      paidFrom: f.text("paidFrom"),
      vendor: f.optionalText("vendor"),
      description: f.optionalText("description"),
      lines,
    });
    // The expense is booked first; a refused receipt leaves it without one and says so.
    if (file) await sendDocument(file, "receipt", { expenseId: expense.id });
    revalidatePath("/expenses");
  });
}

export async function reverseExpense(id: string, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    await api("POST", `/expenses/${id}/reverse`, { bookingDate: fields(data).text("bookingDate") });
    revalidatePath("/expenses");
  });
}
