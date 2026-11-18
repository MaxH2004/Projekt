-- One-time recovery codes for two-factor authentication. Only a hash of each
-- code is stored; a used code stays with its time of use.

CREATE TABLE recovery_code (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user (id),
  code_hash  bytea NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recovery_code_user_idx ON recovery_code (user_id);

ALTER TABLE recovery_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_code FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_only ON recovery_code TO hv_auth USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON recovery_code TO hv_auth;

-- Expired sessions are deleted regularly; this index keeps that cheap.
CREATE INDEX session_expires_idx ON session (expires_at);
