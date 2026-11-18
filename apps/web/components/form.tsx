"use client";

import { useActionState, useEffect, useRef, useTransition, type ReactNode } from "react";
import type { FormState } from "../lib/form";

type Action = (previous: FormState, data: FormData) => Promise<FormState>;

/**
 * A form that sends its data to a server action. Input stays as typed when
 * the action reports an error, and fields named in the error are marked.
 * The form clears itself after a success unless the action navigates away.
 */
export function Form({ action, submit, children, className, success }: { action: Action; submit: string; children: ReactNode; className?: string; success?: string }) {
  const [state, dispatch] = useActionState(action, {});
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const invalid = new Set(state.error?.fields ?? []);
    for (const element of Array.from(form.elements)) {
      const el = element as HTMLInputElement;
      if (!el.name) continue;
      const names = [el.name, el.dataset.field].filter(Boolean) as string[];
      if (names.some((n) => invalid.has(n))) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
    }
  }, [state.error]);

  useEffect(() => {
    if (state.done) ref.current?.reset();
  }, [state.done]);

  return (
    <form
      ref={ref}
      className={className ?? "form"}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        startTransition(() => dispatch(data));
      }}
    >
      {children}
      {state.error ? (
        <p className="form-error" role="alert">
          {state.error.message}
        </p>
      ) : null}
      {success && state.done && !state.error ? (
        <p className="form-success" role="status">
          {success}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="submit" disabled={pending}>
          {submit}
        </button>
      </div>
    </form>
  );
}

/** A button that runs a server action without fields of its own, e.g. "cancel". */
export function ActionButton({ action, label, className }: { action: Action; label: string; className?: string }) {
  const [state, dispatch] = useActionState(action, {});
  const [pending, startTransition] = useTransition();
  return (
    <span className="action-button">
      <button type="button" className={className ?? "secondary"} disabled={pending} onClick={() => startTransition(() => dispatch(new FormData()))}>
        {label}
      </button>
      {state.error ? (
        <span className="form-error" role="alert">
          {state.error.message}
        </span>
      ) : null}
    </span>
  );
}
