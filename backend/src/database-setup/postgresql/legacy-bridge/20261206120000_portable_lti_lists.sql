-- LTI roles and scopes are opaque ordered protocol lists, stored as JSON.
ALTER TABLE public.lti_launch
    ALTER COLUMN roles TYPE jsonb USING to_jsonb(roles);

ALTER TABLE public.lti_access_token
    ALTER COLUMN scopes TYPE jsonb USING to_jsonb(scopes);
