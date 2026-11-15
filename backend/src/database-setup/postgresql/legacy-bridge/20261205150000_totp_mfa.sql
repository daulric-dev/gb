-- Authenticator-app (TOTP, RFC 6238) two-step verification (src/mfa).
--
-- account.mfa_totp: one row per user who has started or finished setting up
-- an authenticator app. `secret_enc` is the active secret (null until the
-- first code is confirmed); `pending_secret_enc` a secret being set up (first
-- time, or moving to a new phone) that replaces it once a code from it is
-- confirmed. Both are sealed with src/account/secret-box.ts (info
-- `gradebook:mfa-totp:v1`, the user id as additional data), never stored in
-- clear. `last_used_step` is the 30-second time step of the last accepted
-- code, so a code is never accepted twice. `failed_attempts` / `locked_until`
-- lock sign-in codes for a while after repeated wrong codes.
CREATE TABLE account.mfa_totp (
    user_id             uuid PRIMARY KEY REFERENCES account.app_user (id) ON DELETE CASCADE,
    secret_enc          text,
    pending_secret_enc  text,
    pending_created_at  timestamptz,
    enabled_at          timestamptz,
    last_used_step      bigint,
    failed_attempts     integer NOT NULL DEFAULT 0,
    locked_until        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mfa_totp_enabled_has_secret CHECK (enabled_at IS NULL OR secret_enc IS NOT NULL),
    CONSTRAINT mfa_totp_failed_attempts_check CHECK (failed_attempts >= 0)
);

-- Ten one-time recovery codes per user, kept only as SHA-256 hashes.
CREATE TABLE account.mfa_recovery_code (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES account.app_user (id) ON DELETE CASCADE,
    code_hash  text NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mfa_recovery_code_user_hash_unique UNIQUE (user_id, code_hash)
);
CREATE INDEX mfa_recovery_code_user_idx ON account.mfa_recovery_code (user_id);

-- A session that signed in while the organisation requires an authenticator
-- app for the user's role and they have none: until they set one up it may
-- only reach the set-up routes (403 MFA_ENROLMENT_REQUIRED elsewhere).
CREATE TABLE account.mfa_enrolment_gate (
    session_id uuid PRIMARY KEY REFERENCES account.session (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES account.app_user (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mfa_enrolment_gate_user_idx ON account.mfa_enrolment_gate (user_id);

-- Organisation setting: require an authenticator app for administrators and
-- holders of the safeguarding permission. Off by default.
ALTER TABLE public.organisation
    ADD COLUMN require_mfa_for_admins boolean NOT NULL DEFAULT false;
