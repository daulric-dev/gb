-- Integrations: optional custom headers per webhook.
--
-- Some receivers only accept requests that carry a key of theirs
-- (`Authorization: Bearer ...`, `X-API-Key: ...`). A webhook may now have up
-- to 20 extra headers, set like environment variables (a name and a secret
-- value), sent with every delivery: events, tests and redeliveries.
--
-- public.school_webhook_header  one header of one webhook.
--   name        an HTTP token (letters, digits, '-'), at most 100 characters,
--               unique per webhook ignoring case. Not one of the headers
--               GradeBook sets itself (Content-Type, Content-Length, Host,
--               User-Agent, Transfer-Encoding, Connection, X-GradeBook-*):
--               checked by the API. Authorization is allowed.
--   value_enc   the value: AES-256-GCM ciphertext under a key derived from
--               AUTH_SECRET with its own HKDF info (not the signing secret's)
--               and the school, webhook and header id as additional data, so
--               it can't be moved to another header, webhook or school, or
--               swapped with school_webhook.secret_enc. Never plaintext;
--               never returned by the API; never audited (names only).
--
-- Existing webhooks have no headers: nothing changes for them.

CREATE TABLE public.school_webhook_header (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    webhook_id uuid NOT NULL,
    name text NOT NULL,
    value_enc text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT school_webhook_header_pkey PRIMARY KEY (id),
    CONSTRAINT school_webhook_header_webhook_id_fkey FOREIGN KEY (webhook_id) REFERENCES public.school_webhook(id) ON DELETE CASCADE,
    CONSTRAINT school_webhook_header_name_check CHECK ((name ~ '^[A-Za-z0-9-]{1,100}$'))
);

CREATE UNIQUE INDEX school_webhook_header_name_key ON public.school_webhook_header USING btree (webhook_id, lower(name));
