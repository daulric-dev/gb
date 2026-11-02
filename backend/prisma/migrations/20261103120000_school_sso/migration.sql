-- Single sign-on is configured per school.
--
-- Replaces public.sso_provider_setting (20261103100000_sso_settings): one
-- server-wide row per provider, never released, so it is dropped with its
-- rows rather than copied.
--
-- public.school_sso_provider    one row per (school, OAuth provider): the
--                               school's own Google or Microsoft app.
--   provider           google | azure (SAML needs no app: each email
--                      domain holds its identity provider's details).
--   enabled            the school offers this provider. A row that is off
--                      also stops the install-wide env credentials from
--                      applying to the school.
--   client_id          the OAuth client ID.
--   client_secret_enc  AES-256-GCM ciphertext under a key derived from
--                      AUTH_SECRET, bound to the school and provider;
--                      plaintext never lands here.
--   settings           non-secret extras (a JSON object).
--   updated_by         who last saved it (no foreign key: the row outlives
--                      the account).
-- No row for a provider: the school uses the env credentials
-- (SSO_PROVIDERS, GOOGLE_*, MICROSOFT_*), when the install sets them.

DROP TABLE IF EXISTS public.sso_provider_setting;

CREATE TABLE public.school_sso_provider (
    school_id uuid NOT NULL,
    provider text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    client_id text,
    client_secret_enc text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT school_sso_provider_pkey PRIMARY KEY (school_id, provider),
    CONSTRAINT school_sso_provider_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'azure'::text]))),
    CONSTRAINT school_sso_provider_settings_object_check CHECK ((jsonb_typeof(settings) = 'object'::text)),
    CONSTRAINT school_sso_provider_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE
);
