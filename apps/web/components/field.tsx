import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

type Control = ReactElement<{ id?: string; "aria-describedby"?: string }>;

/**
 * A labelled control. The label points at the control by id, and the hint is
 * linked as its description, so screen readers announce both correctly.
 */
export function Field({ label, children, hint, wide }: { label: string; children: Control; hint?: string; wide?: boolean }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const control: ReactNode = isValidElement(children) ? cloneElement(children, { id, ...(hint ? { "aria-describedby": hintId } : {}) }) : children;
  return (
    <div className={wide ? "field wide" : "field"}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {control}
      {hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
