-- Users, memberships and sessions.
--
-- These tables are not tenant data: a login has to find a user before any
-- tenant is known. They are reachable only through the role hv_auth, which the
-- application assumes for identity transactions. hv_app has no access at all.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hv_auth') THEN
    CREATE ROLE hv_auth NOLOGIN;
  END IF;
END $$;

CREATE TABLE app_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND email LIKE '_%@_%'),
  password_hash   text NOT NULL,
  -- Keep in step with SUPPORTED_LOCALES in packages/contracts.
  locale          text NOT NULL DEFAULT 'de' CHECK (locale IN ('de', 'fr', 'es')),
  -- TOTP secret, encrypted by the application. Active once totp_enabled_at is set.
  totp_secret     text,
  totp_enabled_at timestamptz,
  -- Last accepted TOTP time step; a code cannot be used twice.
  totp_last_step  bigint,
  failed_logins   integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (totp_enabled_at IS NULL OR totp_secret IS NOT NULL)
);

CREATE TABLE membership (
  user_id    uuid NOT NULL REFERENCES app_user (id),
  tenant_id  uuid NOT NULL REFERENCES organization (id),
  role       text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE session (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the session token; the token itself is never stored.
  token_hash bytea NOT NULL UNIQUE,
  user_id    uuid NOT NULL,
  tenant_id  uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (user_id, tenant_id) REFERENCES membership (user_id, tenant_id)
);
CREATE INDEX session_user_idx ON session (user_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_user', 'membership', 'session'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY identity_only ON %I TO hv_auth USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO hv_auth;
GRANT SELECT, INSERT, UPDATE ON app_user TO hv_auth;
GRANT SELECT, INSERT ON membership TO hv_auth;
GRANT SELECT, INSERT, DELETE ON session TO hv_auth;

-- Registration creates the organization. hv_auth may insert and read
-- organizations, but nothing else in tenant data.
CREATE POLICY provisioning_insert ON organization FOR INSERT TO hv_auth WITH CHECK (true);
CREATE POLICY provisioning_select ON organization FOR SELECT TO hv_auth USING (true);
GRANT SELECT, INSERT ON organization TO hv_auth;
