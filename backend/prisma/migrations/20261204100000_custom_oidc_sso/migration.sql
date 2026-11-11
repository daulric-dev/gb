-- Custom OpenID Connect sign-in (src/sso/adapters/custom-oidc.adapter.ts):
-- a school's own OpenID Connect identity provider (Keycloak, Authentik,
-- Okta, a home-built one), saved like its Google and Microsoft apps.
--
-- public.school_sso_provider gains the provider id `oidc`. Its settings live
-- in the existing `settings` jsonb (issuer, displayName, emailClaim, scope,
-- allowPrivateNetwork); the client secret in `client_secret_enc`, as for the
-- other apps. Nothing else changes: school_email_domain.sso_provider already
-- accepts any adapter id, and account.identity stores `oidc` subjects as
-- `<schoolId>:<issuer hash>:<sub>`.

ALTER TABLE public.school_sso_provider
  DROP CONSTRAINT school_sso_provider_provider_check;

ALTER TABLE public.school_sso_provider
  ADD CONSTRAINT school_sso_provider_provider_check
  CHECK ((provider = ANY (ARRAY['google'::text, 'azure'::text, 'oidc'::text])));
