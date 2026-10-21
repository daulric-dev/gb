-- Our own authentication, replacing the hosted auth service's tables.
--
-- Phase 3 of docs/content/platform-migration.md. Additive: nothing reads
-- these until the API's auth module switches over, and the old auth tables
-- stay until the move off the hosted database.
--
-- Users keep their ids. account.app_user.id is copied from the old auth
-- users, so user_profile and every table pointing at it is untouched; only
-- user_profile's foreign key is re-pointed, in the cut-over migration.

CREATE SCHEMA IF NOT EXISTS "account";
GRANT USAGE ON SCHEMA "account" TO "service_role";

-- ── users ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "account"."app_user" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    -- Lower-cased on write; uniqueness is on the stored value.
    "email" "text" NOT NULL,
    "email_verified_at" timestamp with time zone,
    -- Set to stop all sign-ins without deleting the account.
    "disabled_at" timestamp with time zone,
    "last_sign_in_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_user_email_key" UNIQUE ("email"),
    CONSTRAINT "app_user_email_lower" CHECK ("email" = lower("email"))
);

-- ── sessions ────────────────────────────────────────────────────────────────

-- One row per signed-in device. The cookie carries a random token; only its
-- SHA-256 is stored, so a database leak does not hand out sessions.
CREATE TABLE IF NOT EXISTS "account"."session" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL REFERENCES "account"."app_user"("id") ON DELETE CASCADE,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "user_agent" "text",
    "ip" "text",
    -- How this session was started: 'email-code', or an SSO adapter id.
    "method" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_token_hash_key" UNIQUE ("token_hash")
);
CREATE INDEX IF NOT EXISTS "session_user_id_idx" ON "account"."session" ("user_id");
CREATE INDEX IF NOT EXISTS "session_expires_at_idx" ON "account"."session" ("expires_at");

-- ── email sign-in codes ─────────────────────────────────────────────────────

-- Codes are hashed with a server secret; attempts are counted so a code
-- cannot be guessed, and a new code replaces any unused one for the address.
CREATE TABLE IF NOT EXISTS "account"."email_code" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "email" "text" NOT NULL,
    "code_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "attempts" integer NOT NULL DEFAULT 0,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_code_email_lower" CHECK ("email" = lower("email"))
);
CREATE INDEX IF NOT EXISTS "email_code_email_idx" ON "account"."email_code" ("email", "created_at" DESC);

-- ── linked sign-in providers ────────────────────────────────────────────────

-- A user's account at an SSO provider: (provider, subject) is how the
-- provider identifies them, stable even if their email changes there.
-- claims keeps what the provider vouched for (hd, tid, ...) at last sign-in.
CREATE TABLE IF NOT EXISTS "account"."identity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL REFERENCES "account"."app_user"("id") ON DELETE CASCADE,
    "provider" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "email" "text",
    "claims" "jsonb" NOT NULL DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "identity_provider_subject_key" UNIQUE ("provider", "subject")
);
CREATE INDEX IF NOT EXISTS "identity_user_id_idx" ON "account"."identity" ("user_id");

-- ── per-school SAML connections ─────────────────────────────────────────────

-- Schools configure their own SAML identity provider on a verified email
-- domain - no platform operator or paid plan involved.
ALTER TABLE "public"."school_email_domain"
  ADD COLUMN IF NOT EXISTS "saml_entry_point" "text",
  ADD COLUMN IF NOT EXISTS "saml_issuer" "text",
  ADD COLUMN IF NOT EXISTS "saml_certificate" "text";

-- Only the API touches these, as with the rest of the app's tables.
ALTER TABLE "account"."app_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account"."session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account"."email_code" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account"."identity" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON ALL TABLES IN SCHEMA "account" TO "service_role";
