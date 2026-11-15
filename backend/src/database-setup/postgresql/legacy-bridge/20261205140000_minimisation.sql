-- Data minimisation and user controls (GDPR Art 5(1)(c), 16, 18, 21, 25).
--
-- * student.student_restriction: per-student restriction / objection flags
--   staff set on the student's page (student:update). `no_ai`: the student's
--   work is never sent to an AI provider; `no_similarity`: their submissions
--   are not fingerprinted or compared; `exclude_from_analytics`: they are
--   left out of the analytics at-risk lists. `set_by` (no foreign key: the
--   row outlives the staff member) and `set_at` record the last change; each
--   change is also written to the audit log. No row = no restriction.
-- * public.notification_preference: per account, the notification
--   categories turned off per channel (`push_off`, `email_off`). No row, or
--   an empty array, = everything on. Parents keep
--   student.parent_notification_pref for their notices.
-- * public.organisation.push_content / public.school.push_content: what a
--   push shows on the lock screen. 'full' = the title and text; 'generic' =
--   "GradeBook" / "You have a new update" with only ids in the data. NULL on
--   the school = the organisation's choice; NULL on both = generic for
--   notices about children (parents, attendance, grades, discussion replies)
--   and full for course news (new work, announcements).
-- * account.email_change: one pending, code-confirmed email change per
--   account (the code is HMAC'd with the server secret, never stored). Rows
--   are deleted when confirmed, cancelled or replaced, and expired ones are
--   cleared as new requests arrive.

-- ── student restrictions ──────────────────────────────────────────────────

CREATE TABLE student.student_restriction (
    student_id uuid NOT NULL,
    no_ai boolean DEFAULT false NOT NULL,
    no_similarity boolean DEFAULT false NOT NULL,
    exclude_from_analytics boolean DEFAULT false NOT NULL,
    set_by uuid,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_restriction_pkey PRIMARY KEY (student_id),
    CONSTRAINT student_restriction_student_id_fkey FOREIGN KEY (student_id)
        REFERENCES student.student(id) ON DELETE CASCADE
);

-- ── notification preferences ──────────────────────────────────────────────

CREATE TABLE public.notification_preference (
    user_profile_id uuid NOT NULL,
    push_off text[] DEFAULT '{}'::text[] NOT NULL,
    email_off text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_preference_pkey PRIMARY KEY (user_profile_id),
    CONSTRAINT notification_preference_user_profile_id_fkey FOREIGN KEY (user_profile_id)
        REFERENCES public.user_profile(id) ON DELETE CASCADE,
    CONSTRAINT notification_preference_push_off_check CHECK (
        push_off <@ ARRAY['announcements', 'coursework', 'grades', 'discussions', 'attendance', 'chat']::text[]
    ),
    CONSTRAINT notification_preference_email_off_check CHECK (
        email_off <@ ARRAY['announcements', 'coursework', 'grades', 'discussions', 'attendance', 'chat']::text[]
    )
);

-- ── push content ──────────────────────────────────────────────────────────

ALTER TABLE public.organisation
    ADD COLUMN push_content text,
    ADD CONSTRAINT organisation_push_content_check
        CHECK (push_content IS NULL OR push_content = ANY (ARRAY['full'::text, 'generic'::text]));

ALTER TABLE public.school
    ADD COLUMN push_content text,
    ADD CONSTRAINT school_push_content_check
        CHECK (push_content IS NULL OR push_content = ANY (ARRAY['full'::text, 'generic'::text]));

-- ── pending email changes ─────────────────────────────────────────────────

CREATE TABLE account.email_change (
    user_id uuid NOT NULL,
    new_email text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    sends integer DEFAULT 1 NOT NULL,
    window_started_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_change_pkey PRIMARY KEY (user_id),
    CONSTRAINT email_change_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES account.app_user(id) ON DELETE CASCADE,
    CONSTRAINT email_change_new_email_check CHECK (
        new_email = lower(btrim(new_email)) AND char_length(new_email) BETWEEN 3 AND 320
    )
);

CREATE INDEX idx_email_change_expires ON account.email_change USING btree (expires_at);
