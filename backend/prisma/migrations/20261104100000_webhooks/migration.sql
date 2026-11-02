-- Integrations: webhooks.
--
-- A school's admin (or an organisation admin) registers URLs that receive
-- platform events (grades, attendance, people, courses) as signed JSON POSTs.
-- Gated by the `integrations` feature (off by default).
--
-- public.school_webhook        one target URL with the event types it wants.
--   events          explicit event type keys (src/integrations/webhook-event-types.ts).
--   secret_enc      the HMAC signing secret, AES-256-GCM ciphertext under a
--                   key derived from AUTH_SECRET, bound to the school and the
--                   webhook id. Never plaintext; never returned by the API.
--   consecutive_failures / disabled_reason  auto-disable after too many
--                   failed deliveries in a row.
--
-- public.webhook_delivery      one event for one webhook, and its retries.
--   status          pending | succeeded | failed | abandoned.
--   next_attempt_at when the worker should try (again); null once finished.
--                   Claiming a row pushes it forward (a lease), so a crashed
--                   worker's row is retried later rather than lost.
--   payload         the exact JSON body sent: personal data, purged after
--                   WEBHOOK_DELIVERY_RETENTION_DAYS (default 30).
--   response_excerpt at most 1 KB of the receiver's last response.
--
-- public.integration_audit_log one row per change, test or redelivery,
--                   written in the same transaction. Never a secret.

CREATE TABLE public.school_webhook (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    secret_enc text NOT NULL,
    events text[] DEFAULT '{}'::text[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    disabled_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT school_webhook_pkey PRIMARY KEY (id),
    CONSTRAINT school_webhook_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE,
    CONSTRAINT school_webhook_name_check CHECK ((char_length(btrim(name)) BETWEEN 1 AND 100)),
    CONSTRAINT school_webhook_url_check CHECK ((url ~* '^https?://' AND char_length(url) <= 2048)),
    CONSTRAINT school_webhook_failures_check CHECK ((consecutive_failures >= 0))
);

CREATE INDEX school_webhook_school_enabled_idx ON public.school_webhook USING btree (school_id, enabled);

CREATE TABLE public.webhook_delivery (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    webhook_id uuid NOT NULL,
    school_id uuid NOT NULL,
    event_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now(),
    last_status_code integer,
    last_error text,
    response_excerpt text,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    CONSTRAINT webhook_delivery_pkey PRIMARY KEY (id),
    CONSTRAINT webhook_delivery_webhook_id_fkey FOREIGN KEY (webhook_id) REFERENCES public.school_webhook(id) ON DELETE CASCADE,
    CONSTRAINT webhook_delivery_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'abandoned'::text]))),
    CONSTRAINT webhook_delivery_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT webhook_delivery_excerpt_check CHECK ((response_excerpt IS NULL OR char_length(response_excerpt) <= 1024))
);

CREATE INDEX webhook_delivery_due_idx ON public.webhook_delivery USING btree (status, next_attempt_at);
CREATE INDEX webhook_delivery_webhook_created_idx ON public.webhook_delivery USING btree (webhook_id, created_at DESC, id DESC);
CREATE INDEX webhook_delivery_created_idx ON public.webhook_delivery USING btree (created_at);

CREATE TABLE public.integration_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    webhook_id uuid,
    webhook text,
    actor_id uuid,
    actor_via text NOT NULL,
    action text NOT NULL,
    changes jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT integration_audit_log_pkey PRIMARY KEY (id),
    CONSTRAINT integration_audit_log_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE,
    CONSTRAINT integration_audit_log_actor_via_check CHECK ((actor_via = ANY (ARRAY['school_admin'::text, 'organisation_admin'::text, 'system'::text]))),
    CONSTRAINT integration_audit_log_action_check CHECK ((action = ANY (ARRAY['webhook_created'::text, 'webhook_updated'::text, 'webhook_deleted'::text, 'webhook_enabled'::text, 'webhook_disabled'::text, 'webhook_auto_disabled'::text, 'secret_rotated'::text, 'test_sent'::text, 'delivery_redelivered'::text]))),
    CONSTRAINT integration_audit_log_changes_object_check CHECK ((jsonb_typeof(changes) = 'object'::text))
);

CREATE INDEX integration_audit_log_school_created_idx ON public.integration_audit_log USING btree (school_id, created_at DESC, id DESC);
