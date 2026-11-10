-- Behaviour and pastoral notes (src/pastoral, ROADMAP item 14), behind the
-- pastoral_notes feature (off by default).
--
-- Private staff notes about a student. Visibility is decided in the API by
-- the new permissions pastoral-note:read / :create / :update and the stricter
-- pastoral-note:safeguarding (safeguarding categories); authors always see
-- their own notes. Nothing outside src/pastoral reads these tables (no
-- student or parent portal, report card, webhook or LTI path).
--
-- Personal data: notes cascade with the student and the school; resolved
-- notes are purged after the school's retention_days (src/retention), and
-- deleting or purging a note is written to compliance.erasure_log, whose kind
-- list gains 'pastoral_note' below.

CREATE TABLE student.pastoral_category (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  label text NOT NULL,
  kind text NOT NULL,
  is_safeguarding boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  archived_at timestamp(6) with time zone,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pastoral_category_pkey PRIMARY KEY (id),
  CONSTRAINT pastoral_category_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT pastoral_category_kind_check CHECK (kind IN
    ('behaviour_positive', 'behaviour_concern', 'pastoral', 'safeguarding', 'medical', 'other')),
  CONSTRAINT pastoral_category_label_check CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  -- A safeguarding-kind category is always a safeguarding category.
  CONSTRAINT pastoral_category_safeguarding_check CHECK (kind <> 'safeguarding' OR is_safeguarding)
);
CREATE UNIQUE INDEX pastoral_category_school_label_key ON student.pastoral_category USING btree (school_id, label);

CREATE TABLE student.pastoral_note (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  student_id uuid NOT NULL,
  category_id uuid NOT NULL,
  is_safeguarding boolean NOT NULL DEFAULT false,
  severity text NOT NULL DEFAULT 'low',
  occurred_on date NOT NULL,
  body text NOT NULL,
  follow_up_on date,
  assigned_to uuid,
  status text NOT NULL DEFAULT 'open',
  resolved_at timestamp(6) with time zone,
  resolved_by uuid,
  author_id uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pastoral_note_pkey PRIMARY KEY (id),
  CONSTRAINT pastoral_note_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT pastoral_note_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT pastoral_note_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES student.pastoral_category(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT pastoral_note_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT pastoral_note_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT pastoral_note_severity_check CHECK (severity IN ('low', 'medium', 'high')),
  CONSTRAINT pastoral_note_status_check CHECK (status IN ('open', 'resolved')),
  CONSTRAINT pastoral_note_resolved_check CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CONSTRAINT pastoral_note_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000)
);
CREATE INDEX idx_pastoral_note_student ON student.pastoral_note USING btree (student_id, occurred_on DESC);
CREATE INDEX idx_pastoral_note_school ON student.pastoral_note USING btree (school_id, occurred_on DESC);
CREATE INDEX idx_pastoral_note_follow_up ON student.pastoral_note USING btree (assigned_to, follow_up_on) WHERE (status = 'open'::text);
CREATE INDEX pastoral_note_author_id_idx ON student.pastoral_note USING btree (author_id);
CREATE INDEX pastoral_note_category_id_idx ON student.pastoral_note USING btree (category_id);
CREATE INDEX idx_pastoral_note_resolved ON student.pastoral_note USING btree (school_id, resolved_at) WHERE (status = 'resolved'::text);

CREATE TABLE student.pastoral_note_file (
  note_id uuid NOT NULL,
  file_id uuid NOT NULL,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pastoral_note_file_pkey PRIMARY KEY (note_id, file_id),
  CONSTRAINT pastoral_note_file_note_id_fkey
    FOREIGN KEY (note_id) REFERENCES student.pastoral_note(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT pastoral_note_file_file_id_fkey
    FOREIGN KEY (file_id) REFERENCES file_manager.file(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX pastoral_note_file_file_id_idx ON student.pastoral_note_file USING btree (file_id);

CREATE TABLE student.pastoral_setting (
  school_id uuid NOT NULL,
  retention_days integer,
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pastoral_setting_pkey PRIMARY KEY (school_id),
  CONSTRAINT pastoral_setting_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT pastoral_setting_retention_check CHECK (retention_days IS NULL OR retention_days BETWEEN 30 AND 36500)
);

-- permission_catalog only allowed the four CRUD actions (baseline CHECK).
-- pastoral-note:safeguarding is the first non-CRUD action (EXTRA_ACTIONS in
-- src/permission/permission.catalog.ts), so widen the CHECK before inserting
-- it; the boot-time catalog sync needs this too.
ALTER TABLE public.permission_catalog DROP CONSTRAINT permission_catalog_action_check;
ALTER TABLE public.permission_catalog ADD CONSTRAINT permission_catalog_action_check
    CHECK ((action = ANY (ARRAY['create'::text, 'read'::text, 'update'::text, 'delete'::text, 'safeguarding'::text])));

-- The catalog rows for the new keys (the boot sync adds them too, after
-- migrations). No grants: no existing key gated pastoral notes, so nobody
-- loses access; admins hold every key in code, teachers get :create by
-- default, and schools grant the rest to roles on the Roles page.
INSERT INTO public.permission_catalog (id, resource, action, key, description, created_at)
VALUES
  (gen_random_uuid(), 'pastoral-note', 'read', 'pastoral-note:read',
   'View behaviour and pastoral notes about students', now()),
  (gen_random_uuid(), 'pastoral-note', 'create', 'pastoral-note:create',
   'Write behaviour and pastoral notes', now()),
  (gen_random_uuid(), 'pastoral-note', 'update', 'pastoral-note:update',
   'Edit, resolve and delete behaviour and pastoral notes', now()),
  (gen_random_uuid(), 'pastoral-note', 'safeguarding', 'pastoral-note:safeguarding',
   'See, write and edit safeguarding notes (with the read, create or edit key)', now())
ON CONFLICT (resource, action) DO UPDATE
  SET key = EXCLUDED.key, description = EXCLUDED.description;

-- Erasure log: deleting or purging a pastoral note is an erasure.
ALTER TABLE compliance.erasure_log DROP CONSTRAINT erasure_log_kind_check;
ALTER TABLE compliance.erasure_log ADD CONSTRAINT erasure_log_kind_check CHECK ((kind = ANY (ARRAY[
  'account'::text, 'student'::text, 'school_membership'::text, 'file'::text, 'folder'::text,
  'chat_message'::text, 'discussion_topic'::text, 'discussion_reply'::text, 'course'::text,
  'attendance_session'::text, 'pastoral_note'::text])));
