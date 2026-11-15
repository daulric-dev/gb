-- Bridge: idempotent. A development database that ran `prisma db push` on
-- this branch before the bridge existed can already be in the target shape
-- (new table present, old array column gone) without this migration being
-- recorded; each step below checks the current shape first.

CREATE TABLE IF NOT EXISTS public.job_lease (
    key text NOT NULL,
    owner_token text,
    expires_at timestamp(6) with time zone,
    updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
    CONSTRAINT job_lease_pkey PRIMARY KEY (key)
);
