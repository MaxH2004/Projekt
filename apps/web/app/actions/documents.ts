"use server";

import { DOCUMENT_MAX_BYTES, type DocumentInfo, type DocumentKind } from "@hv/contracts";
import { revalidatePath } from "next/cache";
import { api, apiUpload } from "../../lib/api";
import { fields, formAction, InvalidInput, type FormState } from "../../lib/form";

export interface DocumentTarget {
  propertyId?: string;
  tenancyId?: string;
  expenseId?: string;
  /** Page to refresh afterwards. */
  path: string;
}

/** Sends one file to the API; also used when an expense is recorded with its receipt. */
export async function sendDocument(file: File, kind: DocumentKind, target: Omit<DocumentTarget, "path">): Promise<DocumentInfo> {
  if (file.size > DOCUMENT_MAX_BYTES) throw new InvalidInput(["file"]);
  const query = new URLSearchParams({ kind, fileName: file.name || "upload" });
  for (const [key, value] of Object.entries(target)) if (value) query.set(key, value);
  return apiUpload<DocumentInfo>(`/documents/upload?${query}`, await file.arrayBuffer());
}

export async function uploadDocument(target: DocumentTarget, previous: FormState, data: FormData): Promise<FormState> {
  return formAction(previous, async () => {
    const f = fields(data);
    const { path, ...links } = target;
    await sendDocument(f.file("file"), f.text("kind") as DocumentKind, links);
    revalidatePath(path);
  });
}

export async function deleteDocument(id: string, path: string, previous: FormState): Promise<FormState> {
  return formAction(previous, async () => {
    await api("DELETE", `/documents/${id}`);
    revalidatePath(path);
  });
}
