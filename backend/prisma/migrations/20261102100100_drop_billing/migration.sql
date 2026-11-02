-- Remove billing.
--
-- GradeBook is no longer a hosted, paid service: each install is run by its
-- own organisation. The `billing` schema (subscription, invoice,
-- payment_event, provider_setting, job_lease, platform_admin) goes, with its
-- data. Platform admins were copied to public.organisation_admin by
-- 20261102100000_organisation, which runs first.
--
-- account.session.revoked_reason has no CHECK constraint: sessions ended
-- with the old 'platform_admin' reason keep it; new ones read
-- 'organisation_admin'.

DROP SCHEMA IF EXISTS billing CASCADE;
