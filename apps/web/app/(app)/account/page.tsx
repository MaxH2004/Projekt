import type { MeResponse, TotpSetupResponse } from "@hv/contracts";
import { cookies } from "next/headers";
import { Field } from "../../../components/field";
import { ActionButton, Form } from "../../../components/form";
import { apiGet, TOTP_SETUP_COOKIE } from "../../../lib/api";
import { getTranslate } from "../../../lib/locale";
import { enableTotp, startTotpSetup } from "../../actions/account";

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
  const me = await apiGet<MeResponse>("/auth/me");
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
