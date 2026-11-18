import { formatIban, type MeResponse, type OrganizationDetails, type TotpSetupResponse } from "@hv/contracts";
import { cookies } from "next/headers";
import { Field } from "../../../components/field";
import { ActionButton, Form } from "../../../components/form";
import { apiGet, TOTP_SETUP_COOKIE } from "../../../lib/api";
import { getTranslate } from "../../../lib/locale";
import { enableTotp, saveOrganizationDetails, startTotpSetup } from "../../actions/account";

function readSetup(value: string | undefined): TotpSetupResponse | null {
  try {
    const parsed = value ? (JSON.parse(value) as TotpSetupResponse) : null;
    return parsed && typeof parsed.secret === "string" && parsed.uri.startsWith("otpauth://") ? parsed : null;
  } catch {
    return null;
  }
}

export default async function AccountPage() {
  const { t } = await getTranslate();
  const [me, details] = await Promise.all([apiGet<MeResponse>("/auth/me"), apiGet<OrganizationDetails>("/organization/details")]);
  const setup = me.totpEnabled ? null : readSetup((await cookies()).get(TOTP_SETUP_COOKIE)?.value);
  return (
    <>
      <h1>{t("account.title")}</h1>
      <section className="card">
        <dl className="facts">
          <div className="fact">
            <dt>{t("field.email")}</dt>
            <dd>{me.email}</dd>
          </div>
          <div className="fact">
            <dt>{t("field.organizationName")}</dt>
            <dd>{me.organizationName}</dd>
          </div>
        </dl>
      </section>
      <section className="card">
        <h2>{t("account.details")}</h2>
        <p className="muted">{t("account.detailsHint")}</p>
        <Form action={saveOrganizationDetails} submit={t("action.save")} className="form inline">
          <Field label={t("field.street")}>
            <input name="street" maxLength={200} defaultValue={details.street ?? ""} />
          </Field>
          <Field label={t("field.postalCode")}>
            <input name="postalCode" maxLength={20} defaultValue={details.postalCode ?? ""} />
          </Field>
          <Field label={t("field.city")}>
            <input name="city" maxLength={200} defaultValue={details.city ?? ""} />
          </Field>
          <Field label={t("field.accountHolder")}>
            <input name="accountHolder" maxLength={200} defaultValue={details.accountHolder ?? ""} />
          </Field>
          <Field label={t("field.iban")} hint={t("account.ibanHint")}>
            <input name="iban" maxLength={42} autoComplete="off" spellCheck={false} defaultValue={details.iban ? formatIban(details.iban) : ""} />
          </Field>
        </Form>
      </section>
      <section className="card">
        <h2>{t("account.totp")}</h2>
        {me.totpEnabled ? (
          <p className="ok">{t("account.totpEnabled")}</p>
        ) : setup ? (
          <>
            <p>{t("account.totpStep1")}</p>
            <p>
              <code className="secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
            </p>
            <p>
              <a href={setup.uri}>{t("account.totpOpenApp")}</a>
            </p>
            <p>{t("account.totpStep2")}</p>
            <Form action={enableTotp} submit={t("account.totpEnable")} className="form inline">
              <Field label={t("field.totpCode")}>
                <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
              </Field>
            </Form>
          </>
        ) : (
          <>
            <p>{t("account.totpIntro")}</p>
            <ActionButton action={startTotpSetup} label={t("account.totpStart")} className="primary" />
          </>
        )}
      </section>
    </>
  );
}
