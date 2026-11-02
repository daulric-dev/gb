-- Sign-in providers configured from the organisation console.
--
-- public.sso_provider_setting   one row per adapter id (google, azure, saml).
--                               No row: the env vars decide, as before. A
--                               row's non-null values win over the env,
--                               field by field. client_secret_enc is
--                               AES-256-GCM ciphertext under a key derived
--                               from AUTH_SECRET; plaintext never lands here.

CREATE TABLE public.sso_provider_setting (
    provider text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    client_id text,
    client_secret_enc text,
    extra jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT sso_provider_setting_pkey PRIMARY KEY (provider),
    CONSTRAINT sso_provider_setting_extra_object_check CHECK ((jsonb_typeof(extra) = 'object'::text))
);
