import Link from "next/link";
import { Field } from "../../../components/field";
import { Form } from "../../../components/form";
import { getTranslate } from "../../../lib/locale";
import { login } from "../../actions/auth";

export default async function LoginPage() {
  const { t } = await getTranslate();
  return (
    <section className="card narrow">
      <h1>{t("login.title")}</h1>
      <Form action={login} submit={t("login.submit")}>
        <Field label={t("field.email")}>
          <input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label={t("field.password")}>
          <input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Field label={t("field.totpCode")} hint={t("login.totpHint")}>
          <input name="totpCode" autoComplete="one-time-code" maxLength={14} />
        </Field>
      </Form>
      <p className="muted">
        {t("login.noAccount")} <Link href="/register">{t("register.title")}</Link>
      </p>
    </section>
  );
}
