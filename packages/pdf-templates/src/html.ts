/** A string that is already safe to place into HTML. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Template tag: every interpolated value is escaped unless it is SafeHtml
 * (or an array of SafeHtml), so user data can never inject markup.
 */
export function html(strings: TemplateStringsArray, ...values: readonly (string | number | SafeHtml | readonly SafeHtml[])[]): SafeHtml {
  let out = strings[0]!;
  values.forEach((value, i) => {
    if (value instanceof SafeHtml) out += value.value;
    else if (Array.isArray(value)) out += value.map((v: SafeHtml) => v.value).join("");
    else out += escapeHtml(String(value));
    out += strings[i + 1]!;
  });
  return new SafeHtml(out);
}
