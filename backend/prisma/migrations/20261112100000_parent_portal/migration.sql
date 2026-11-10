-- Parent / guardian portal (src/parent-portal), behind the parent_portal
-- feature (off by default).

-- A parent is its own kind of account: never staff (no membership, no
-- catalog permissions) and never a student (no student record).
-- ADD VALUE is not used anywhere else in this migration, so it may run in
-- the same transaction.
ALTER TYPE public.account_type ADD VALUE IF NOT EXISTS 'parent';

-- What parents see, per school. Missing keys use the code defaults.
ALTER TABLE public.school
  ADD COLUMN parent_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT school_parent_settings_object_check
    CHECK (jsonb_typeof(parent_settings) = 'object');

-- parent_student_link was unused: drop orphaned and duplicate rows, then
-- make both sides required, cascade with either side, and one link per pair.
DELETE FROM student.parent_student_link
  WHERE user_profile_id IS NULL OR student_id IS NULL;
DELETE FROM student.parent_student_link a
  USING student.parent_student_link b
  WHERE a.user_profile_id = b.user_profile_id
    AND a.student_id = b.student_id
    AND a.id > b.id;

ALTER TABLE student.parent_student_link
  ALTER COLUMN user_profile_id SET NOT NULL,
  ALTER COLUMN student_id SET NOT NULL,
  ADD COLUMN relationship_label text,
  ADD COLUMN created_by uuid,
  ADD COLUMN created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  ADD CONSTRAINT parent_student_link_label_length_check
    CHECK (relationship_label IS NULL OR char_length(relationship_label) <= 60);

ALTER TABLE student.parent_student_link
  DROP CONSTRAINT parent_student_link_student_id_fkey,
  DROP CONSTRAINT parent_student_link_user_profile_id_fkey;
ALTER TABLE student.parent_student_link
  ADD CONSTRAINT parent_student_link_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT parent_student_link_user_profile_id_fkey
    FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id)
    ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE UNIQUE INDEX parent_student_link_parent_student_key
  ON student.parent_student_link USING btree (user_profile_id, student_id);

-- Invitations: an emailed link bound to an address, or a one-time code.
-- Only the SHA-256 of the token is stored.
CREATE TABLE student.parent_invite (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  school_id uuid NOT NULL,
  kind text NOT NULL,
  email text,
  token_hash text NOT NULL,
  relationship public.relationship_type,
  relationship_label text,
  expires_at timestamp(6) with time zone NOT NULL,
  used_at timestamp(6) with time zone,
  used_by uuid,
  revoked_at timestamp(6) with time zone,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT parent_invite_pkey PRIMARY KEY (id),
  CONSTRAINT parent_invite_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT parent_invite_kind_check CHECK (kind IN ('email', 'code')),
  CONSTRAINT parent_invite_email_check CHECK (
    (kind = 'email' AND email IS NOT NULL AND email = lower(email))
    OR (kind = 'code' AND email IS NULL)
  ),
  CONSTRAINT parent_invite_label_length_check
    CHECK (relationship_label IS NULL OR char_length(relationship_label) <= 60)
);

CREATE UNIQUE INDEX parent_invite_token_hash_key
  ON student.parent_invite USING btree (token_hash);
CREATE INDEX idx_parent_invite_student
  ON student.parent_invite USING btree (student_id, created_at DESC);

-- Notification choices per parent: email and push are opt-in.
CREATE TABLE student.parent_notification_pref (
  user_profile_id uuid NOT NULL,
  email_enabled boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT false,
  kinds text[] NOT NULL DEFAULT ARRAY['missing_work', 'absence', 'new_grade', 'announcement']::text[],
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT parent_notification_pref_pkey PRIMARY KEY (user_profile_id),
  CONSTRAINT parent_notification_pref_user_profile_id_fkey
    FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT parent_notification_pref_kinds_check CHECK (
    kinds <@ ARRAY['missing_work', 'absence', 'new_grade', 'announcement']::text[]
  )
);

-- One row per notice sent, so each event reaches a parent once.
CREATE TABLE student.parent_notification_sent (
  user_profile_id uuid NOT NULL,
  kind text NOT NULL,
  ref_id uuid NOT NULL,
  sent_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT parent_notification_sent_pkey PRIMARY KEY (user_profile_id, kind, ref_id),
  CONSTRAINT parent_notification_sent_user_profile_id_fkey
    FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX idx_parent_notification_sent_at
  ON student.parent_notification_sent USING btree (sent_at);
