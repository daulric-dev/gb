-- Authenticator-app MFA is required for privileged roles by default.
-- Existing organisations receive the same baseline; the policy remains
-- explicitly configurable from the organisation settings endpoint.
ALTER TABLE public.organisation
    ALTER COLUMN require_mfa_for_admins SET DEFAULT true;

UPDATE public.organisation
SET require_mfa_for_admins = true,
    updated_at = now()
WHERE require_mfa_for_admins = false;
