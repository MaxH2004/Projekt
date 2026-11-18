"use client";

import { useId, useState } from "react";

export interface Option {
  readonly value: string;
  readonly label: string;
}

/**
 * Lines of an expense: account, property, amount and category each. One line
 * to start with; more can be added to split an invoice over properties or
 * accounts. Field names carry the line number: accountCode_0, amount_0, …
 */
export function ExpenseLines({
  accounts,
  properties,
  categories,
  labels,
}: {
  accounts: readonly Option[];
  properties: readonly Option[];
  categories: readonly Option[];
  labels: { account: string; property: string; amount: string; category: string; chooseAccount: string; add: string; remove: string; line: string };
}) {
  const id = useId();
  const [lines, setLines] = useState([0]);
  const [next, setNext] = useState(1);
  return (
    <fieldset className="field wide expense-lines">
      {lines.map((key, index) => (
        <div className="expense-line" key={key}>
          <span className="muted small">{labels.line.replace("{number}", String(index + 1))}</span>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-${key}-account`}>
              {labels.account}
            </label>
            <select id={`${id}-${key}-account`} name={`accountCode_${index}`} required defaultValue="" data-field={`lines.${index}.accountCode`}>
              <option value="" disabled>
                {labels.chooseAccount}
              </option>
              {accounts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-${key}-property`}>
              {labels.property}
            </label>
            <select id={`${id}-${key}-property`} name={`propertyId_${index}`} required data-field={`lines.${index}.propertyId`}>
              {properties.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-${key}-amount`}>
              {labels.amount}
            </label>
            <input id={`${id}-${key}-amount`} name={`amount_${index}`} inputMode="decimal" required data-field={`lines.${index}.amountCents`} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-${key}-category`}>
              {labels.category}
            </label>
            <select id={`${id}-${key}-category`} name={`category_${index}`} defaultValue="">
              {categories.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {lines.length > 1 ? (
            <button type="button" className="link-button" onClick={() => setLines(lines.filter((k) => k !== key))}>
              {labels.remove}
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setLines([...lines, next]);
          setNext(next + 1);
        }}
      >
        {labels.add}
      </button>
    </fieldset>
  );
}
