import { formatIban, PASSWORD_MIN_LENGTH, type MeResponse, type OrganizationDetails, type TotpSetupResponse } from "@hv/contracts";
import { cookies } from "next/headers";
import Link from "next/link";
import { Field } from "../../../components/field";
import { ActionButton, Form } from "../../../components/form";
import { apiGet, RECOVERY_CODES_COOKIE, TOTP_SETUP_COOKIE } from "../../../lib/api";
import { getTranslate } from "../../../lib/locale";
import {
  changeEmail,
  changePassword,
  disableTotp,
  dismissRecoveryCodes,
  enableTotp,
  regenerateRecoveryCodes,
  saveOrganizationDetails,
  startTotpSetup,
} from "../../actions/account";

function readCodes(value: string | undefined): string[] | null {
  try {
    const parsed = value ? (JSON.parse(value) as unknown) : null;
    return Array.isArray(parsed) && parsed.every((c) => typeof c === "string") ? parsed : null;
  } catch {
    return null;
  }
}

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
  const jar = await cookies();
  const setup = me.totpEnabled ? null : readSetup(jar.get(TOTP_SETUP_COOKIE)?.value);
  const codes = me.totpEnabled ? readCodes(jar.get(RECOVERY_CODES_COOKIE)?.value) : null;
  return (
    <>
      <h1>{t("account.title")}</h1>
      <p>
        <Link href="/account/audit">{t("audit.title")}</Link>
      </p>
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
          <>
            <p className="ok">{t("account.totpEnabled")}</p>
            {codes ? (
              <div className="card callout">
                <h3>{t("account.recoveryCodes")}</h3>
                <p>{t("account.recoveryCodesHint")}</p>
                <ul className="codes">
                  {codes.map((c) => (
                    <li key={c}>
                      <code className="secret">{c}</code>
                    </li>
                  ))}
                </ul>
                <ActionButton action={dismissRecoveryCodes} label={t("account.recoveryCodesNoted")} className="primary" />
              </div>
            ) : null}
            <div className="columns">
              <details className="card">
                <summary>{t("account.newRecoveryCodes")}</summary>
                <Form action={regenerateRecoveryCodes} submit={t("account.newRecoveryCodes")}>
                  <Field label={t("field.password")}>
                    <input name="password" type="password" autoComplete="current-password" required />
                  </Field>
                  <Field label={t("field.secondFactor")}>
                    <input name="code" autoComplete="one-time-code" required maxLength={14} data-field="totpCode" />
                  </Field>
                </Form>
              </details>
              <details className="card">
                <summary>{t("account.totpDisable")}</summary>
                <p className="muted">{t("account.totpDisableHint")}</p>
                <Form action={disableTotp} submit={t("account.totpDisable")}>
                  <Field label={t("field.password")}>
                    <input name="password" type="password" autoComplete="current-password" required />
                  </Field>
                  <Field label={t("field.secondFactor")}>
                    <input name="code" autoComplete="one-time-code" required maxLength={14} data-field="totpCode" />
                  </Field>
                </Form>
              </details>
            </div>
          </>
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
      <div className="columns">
        <section className="card">
          <h2>{t("account.changePassword")}</h2>
          <Form action={changePassword} submit={t("action.save")} success={t("account.passwordChanged")}>
            <Field label={t("field.currentPassword")}>
              <input name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field label={t("field.newPassword")} hint={t("register.passwordHint", { min: PASSWORD_MIN_LENGTH })}>
              <input name="newPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
            </Field>
          </Form>
        </section>
        <section className="card">
          <h2>{t("account.changeEmail")}</h2>
          <Form action={changeEmail} submit={t("action.save")} success={t("account.emailChanged")}>
            <Field label={t("field.newEmail")}>
              <input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field label={t("field.password")}>
              <input name="password" type="password" autoComplete="current-password" required />
            </Field>
          </Form>
        </section>
      </div>
    </>
  );
}
