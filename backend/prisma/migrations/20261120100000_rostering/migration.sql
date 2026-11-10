-- Rostering sync (src/rostering, feature `rostering`, organisation only):
-- sources (CSV uploads or a OneRoster 1.2 REST endpoint), the sourcedId ->
-- GradeBook id mapping, sync runs and their change sets. Plus the school's
-- own student number on student.student, and a `school_staff` invite kind
-- for rostered staff who have no account yet.

CREATE TABLE public.roster_source (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    base_url text,
    token_url text,
    client_id text,
    client_secret_enc text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    schedule text DEFAULT 'off'::text NOT NULL,
    auto_apply boolean DEFAULT false NOT NULL,
    last_scheduled_at timestamp(6) with time zone,
    created_by uuid,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roster_source_pkey PRIMARY KEY (id),
    CONSTRAINT roster_source_kind_check CHECK ((kind = ANY (ARRAY['csv'::text, 'oneroster_api'::text]))),
    CONSTRAINT roster_source_schedule_check CHECK ((schedule = ANY (ARRAY['off'::text, 'daily'::text]))),
    CONSTRAINT roster_source_name_check CHECK ((char_length(btrim(name)) BETWEEN 1 AND 120)),
    CONSTRAINT roster_source_settings_check CHECK ((jsonb_typeof(settings) = 'object'::text))
);

CREATE TABLE public.roster_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    entity text NOT NULL,
    sourced_id text NOT NULL,
    target_id uuid NOT NULL,
    school_id uuid,
    email text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    disabled_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roster_link_pkey PRIMARY KEY (id),
    CONSTRAINT roster_link_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.roster_source(id) ON DELETE CASCADE,
    CONSTRAINT roster_link_entity_check CHECK ((entity = ANY (ARRAY['school'::text, 'academic_year'::text, 'term'::text, 'course'::text, 'student'::text, 'staff'::text, 'enrolment'::text, 'course_staff'::text])))
);

CREATE UNIQUE INDEX roster_link_source_entity_sourced_key ON public.roster_link USING btree (source_id, entity, sourced_id);
CREATE INDEX roster_link_target_idx ON public.roster_link USING btree (source_id, entity, target_id);
CREATE INDEX roster_link_email_idx ON public.roster_link USING btree (email);

CREATE TABLE public.roster_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    trigger text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'planning'::text NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    include_disables boolean DEFAULT false NOT NULL,
    progress_done integer DEFAULT 0 NOT NULL,
    progress_total integer DEFAULT 0 NOT NULL,
    progress_failed integer DEFAULT 0 NOT NULL,
    created_by uuid,
    applied_by uuid,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    planned_at timestamp(6) with time zone,
    apply_started_at timestamp(6) with time zone,
    heartbeat_at timestamp(6) with time zone,
    finished_at timestamp(6) with time zone,
    CONSTRAINT roster_run_pkey PRIMARY KEY (id),
    CONSTRAINT roster_run_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.roster_source(id) ON DELETE CASCADE,
    CONSTRAINT roster_run_trigger_check CHECK ((trigger = ANY (ARRAY['manual'::text, 'scheduled'::text]))),
    CONSTRAINT roster_run_status_check CHECK ((status = ANY (ARRAY['planning'::text, 'planned'::text, 'queued'::text, 'applying'::text, 'applied'::text, 'failed'::text, 'cancelled'::text])))
);

CREATE INDEX roster_run_source_created_idx ON public.roster_run USING btree (source_id, created_at DESC);
CREATE INDEX roster_run_status_idx ON public.roster_run USING btree (status);

CREATE TABLE public.roster_change (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    seq integer NOT NULL,
    entity text NOT NULL,
    action text NOT NULL,
    sourced_id text NOT NULL,
    target_id uuid,
    school_id uuid,
    label text NOT NULL,
    diff jsonb DEFAULT '{}'::jsonb NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    errors text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    apply_error text,
    applied_at timestamp(6) with time zone,
    CONSTRAINT roster_change_pkey PRIMARY KEY (id),
    CONSTRAINT roster_change_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.roster_run(id) ON DELETE CASCADE,
    CONSTRAINT roster_change_action_check CHECK ((action = ANY (ARRAY['create'::text, 'update'::text, 'disable'::text, 'error'::text]))),
    CONSTRAINT roster_change_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'applied'::text, 'failed'::text, 'skipped'::text])))
);

CREATE UNIQUE INDEX roster_change_run_seq_key ON public.roster_change USING btree (run_id, seq);
CREATE INDEX roster_change_run_status_idx ON public.roster_change USING btree (run_id, status);

-- The school's own student number (SIS identifier): matched on by rostering.
ALTER TABLE student.student ADD COLUMN student_number text;
CREATE UNIQUE INDEX student_school_number_key ON student.student USING btree (school_id, student_number)
  WHERE (student_number IS NOT NULL);

-- Rostered staff without an account get a `school_staff` invite (a teacher
-- membership on first verified sign-in; never admin). One open one per
-- school and email.
ALTER TABLE public.organisation_invite DROP CONSTRAINT organisation_invite_kind_check;
ALTER TABLE public.organisation_invite ADD CONSTRAINT organisation_invite_kind_check
  CHECK ((kind = ANY (ARRAY['school_admin'::text, 'organisation_admin'::text, 'school_staff'::text])));
ALTER TABLE public.organisation_invite DROP CONSTRAINT organisation_invite_school_check;
ALTER TABLE public.organisation_invite ADD CONSTRAINT organisation_invite_school_check
  CHECK (((kind = ANY (ARRAY['school_admin'::text, 'school_staff'::text])) = (school_id IS NOT NULL)));
CREATE UNIQUE INDEX organisation_invite_open_school_staff ON public.organisation_invite USING btree (school_id, email)
  WHERE ((kind = 'school_staff'::text) AND (accepted_at IS NULL) AND (revoked_at IS NULL));
