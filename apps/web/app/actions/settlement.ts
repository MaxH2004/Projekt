"use server";

import type { Settlement } from "@hv/contracts";
import { redirect } from "next/navigation";
import { api } from "../../lib/api";
import { fields, formAction, InvalidInput, type FormState } from "../../lib/form";

/** Stores the settlement for good; the configuration comes from the previewed page. */
export async function finalizeSettlement(previous: FormState, data: FormData): Promise<FormState> {
  let created: Settlement | undefined;
  const state = await formAction(previous, async () => {
    const f = fields(data);
    let config: unknown;
    try {
      config = JSON.parse(f.text("config"));
    } catch {
      throw new InvalidInput(["config"]);
    }
    created = await api<Settlement>("POST", "/settlements", { ...(config as object), dueDate: f.text("dueDate") });
  });
  if (!created) return state;
  redirect(`/settlements/${created.id}`);
}
