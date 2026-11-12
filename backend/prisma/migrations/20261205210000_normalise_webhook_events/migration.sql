-- Store webhook event subscriptions as rows instead of a PostgreSQL array.
CREATE TABLE public.school_webhook_event (
    webhook_id uuid NOT NULL,
    event_type text NOT NULL,
    CONSTRAINT school_webhook_event_pkey PRIMARY KEY (webhook_id, event_type),
    CONSTRAINT school_webhook_event_webhook_fkey FOREIGN KEY (webhook_id)
        REFERENCES public.school_webhook(id) ON DELETE CASCADE
);

CREATE INDEX school_webhook_event_type_idx
    ON public.school_webhook_event (event_type, webhook_id);

INSERT INTO public.school_webhook_event (webhook_id, event_type)
SELECT DISTINCT hook.id, subscription.event_type
FROM public.school_webhook AS hook
CROSS JOIN LATERAL unnest(hook.events) AS subscription(event_type);

ALTER TABLE public.school_webhook DROP COLUMN events;
