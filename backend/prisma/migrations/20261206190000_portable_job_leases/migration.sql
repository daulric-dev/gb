CREATE TABLE public.job_lease (
    key text NOT NULL,
    owner_token text,
    expires_at timestamp(6) with time zone,
    updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
    CONSTRAINT job_lease_pkey PRIMARY KEY (key)
);
