-- Single sign-on per school email domain.
--
-- A verified domain can name the identity provider its people sign in with
-- (an adapter id from backend/src/sso: 'google', 'azure', 'saml', ...), and
-- can require it: email codes are then refused for that domain's addresses,
-- so suspending someone at the school's provider ends their access here too.
--
-- azure_tenant_id is the school's Microsoft Entra tenant. Microsoft does not
-- vouch for the email claim of an arbitrary account, so a Microsoft sign-in
-- only counts as proof of a school address when it comes from this tenant.

ALTER TABLE "public"."school_email_domain"
  ADD COLUMN IF NOT EXISTS "sso_provider" "text",
  ADD COLUMN IF NOT EXISTS "sso_required" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "azure_tenant_id" "text";

ALTER TABLE "public"."school_email_domain"
  ADD CONSTRAINT "school_email_domain_sso_provider_format"
    CHECK ("sso_provider" IS NULL OR "sso_provider" ~ '^[a-z][a-z0-9_-]{1,31}$'),
  -- Requiring SSO without saying which provider would lock everyone out.
  ADD CONSTRAINT "school_email_domain_sso_required_needs_provider"
    CHECK (NOT "sso_required" OR "sso_provider" IS NOT NULL),
  ADD CONSTRAINT "school_email_domain_azure_tenant_format"
    CHECK ("azure_tenant_id" IS NULL OR "azure_tenant_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
