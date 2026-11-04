CREATE TABLE public.audit_log (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    scope text NOT NULL DEFAULT 'school',
    school_id uuid,
    school_name text,
    actor_id uuid,
    actor_name text,
    actor_email text,
    entity text NOT NULL,
    entity_id text,
    action text NOT NULL,
    changes jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT audit_log_pkey PRIMARY KEY (id),
    CONSTRAINT audit_log_school_id_fkey FOREIGN KEY (school_id)
        REFERENCES public.school(id) ON DELETE SET NULL,
    CONSTRAINT audit_log_scope_check CHECK (scope = ANY (ARRAY['school'::text, 'organisation'::text])),
    CONSTRAINT audit_log_changes_object_check
        CHECK (jsonb_typeof(changes) = 'object')
);

CREATE INDEX audit_log_school_created_idx
    ON public.audit_log (school_id, created_at DESC, id DESC);
CREATE INDEX audit_log_created_idx
    ON public.audit_log (created_at DESC, id DESC);
