import { PASSWORD_MIN_LENGTH } from "@hv/contracts";
import Link from "next/link";
import { Field } from "../../../components/field";
import { Form } from "../../../components/form";
import { getTranslate } from "../../../lib/locale";
import { register } from "../../actions/auth";

export default async function RegisterPage() {
  const { t } = await getTranslate();
  return (
    <section className="card narrow">
      <h1>{t("register.title")}</h1>
      <Form action={register} submit={t("register.submit")}>
        <Field label={t("field.organizationName")} hint={t("register.organizationHint")}>
          <input name="organizationName" required maxLength={200} />
        </Field>
        <Field label={t("field.email")}>
          <input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label={t("field.password")} hint={t("register.passwordHint", { min: PASSWORD_MIN_LENGTH })}>
          <input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
        </Field>
      </Form>
      <p className="muted">
        {t("register.haveAccount")} <Link href="/login">{t("login.title")}</Link>
      </p>
    </section>
  );
}
