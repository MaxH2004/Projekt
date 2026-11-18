import { ERROR_CODES, type ErrorCode } from "@hv/contracts";
import { ApiFailure } from "./api";
import { getTranslate } from "./locale";
import { parseMoney } from "./money";

/** What a form action returns to its form. */
export interface FormState {
  readonly error?: { readonly message: string; readonly fields: readonly string[] };
  /** Increases with every success, so the form knows to clear itself. */
  readonly done?: number;
}

/** Input the interface itself rejects before calling the API. */
export class InvalidInput extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Invalid input: ${fields.join(", ")}`);
  }
}

/**
 * Runs the body of a form action. API errors and invalid input become a
 * translated message for the form; everything else (including redirects)
 * passes through.
 */
export async function formAction(previous: FormState, body: () => Promise<void>): Promise<FormState> {
  try {
    await body();
    return { done: (previous.done ?? 0) + 1 };
  } catch (err) {
    const { t } = await getTranslate();
    if (err instanceof ApiFailure) {
      const code: ErrorCode = (ERROR_CODES as readonly string[]).includes(err.code) ? err.code : "conflict";
      return { error: { message: t(`error.${code}`), fields: err.fields } };
    }
    if (err instanceof InvalidInput) return { error: { message: t("error.validation_failed"), fields: err.fields } };
    throw err;
  }
}

/** Reading form fields; each reader throws InvalidInput naming the field. */
export function fields(data: FormData) {
  const raw = (name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    text: (name: string) => {
      const value = raw(name);
      if (!value) throw new InvalidInput([name]);
      return value;
    },
    optionalText: (name: string) => raw(name) || null,
    money: (name: string) => {
      const cents = parseMoney(raw(name));
      if (cents === null) throw new InvalidInput([name]);
      return cents;
    },
    optionalMoney: (name: string) => {
      if (!raw(name)) return 0;
      const cents = parseMoney(raw(name));
      if (cents === null) throw new InvalidInput([name]);
      return cents;
    },
    all: (name: string) => data.getAll(name).filter((v): v is string => typeof v === "string" && v !== ""),
    file: (name: string) => {
      const value = data.get(name);
      if (!(value instanceof File) || value.size === 0) throw new InvalidInput([name]);
      return value;
    },
  };
}
