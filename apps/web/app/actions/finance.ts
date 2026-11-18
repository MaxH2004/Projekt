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
    await api("POST", "/payments", {
      tenancyId,
      receivedOn: f.text("receivedOn"),
      amountCents: f.money("amountCents"),
      reference: f.optionalText("reference"),
    });
    revalidatePath(`/tenancies/${tenancyId}`);
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
    const expense = await api<Expense>("POST", "/expenses", {
      paidOn: f.text("paidOn"),
      paidFrom: f.text("paidFrom"),
      vendor: f.optionalText("vendor"),
      description: f.optionalText("description"),
      lines: [
        { accountCode: f.text("accountCode"), propertyId: f.text("propertyId"), amountCents: f.money("amountCents"), operatingCostCategory: f.optionalText("operatingCostCategory") },
      ],
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
