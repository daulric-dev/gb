-- Subject access and data portability exports (GDPR Art 15 and 20),
-- src/data-export.
--
-- compliance.data_export: one row per export someone asked for. The export
-- itself is a ZIP in object storage (`storage_key`, under `data-exports/`),
-- built in the background and kept for a short time (`expires_at`, 24 hours
-- by default); the purge sweep then deletes the object, marks the row
-- `expired`, and deletes expired rows after 30 days. The row holds ids,
-- counts and status only, never the exported data.
--
--   kind        self    - a person's own account (any account type)
--               student - staff with `student:export` exporting a student
--                         (and the student's linked account)
--               child   - a parent exporting a linked child (what the
--                         school shows parents)
--   manifest    counts per category; for `student` exports also how many
--               pastoral notes were withheld (shown to staff only, never
--               written into the ZIP)
--
-- At most one unfinished export per requester and subject
-- (data_export_one_active_key), so a double click cannot queue two.
--
-- student.pastoral_note gains `sar_withheld` (+ reason, who, when): a note
-- withheld from subject access exports under an exemption (for example
-- serious harm or a safeguarding investigation). Withheld notes never go
-- into any export; changing the flag is audited.

CREATE TABLE compliance.data_export (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  requested_by    uuid        NOT NULL,
  kind            text        NOT NULL,
  subject_user_id uuid,
  student_id      uuid,
  school_id       uuid,
  status          text        NOT NULL DEFAULT 'pending',
  storage_key     text,
  byte_size       bigint,
  manifest        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error           text,
  attempts        integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  expires_at      timestamptz,
  downloaded_at   timestamptz,
  CONSTRAINT data_export_pkey PRIMARY KEY (id),
  CONSTRAINT data_export_kind_check CHECK (kind = ANY (ARRAY['self'::text, 'student'::text, 'child'::text])),
  CONSTRAINT data_export_status_check CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'ready'::text, 'failed'::text, 'expired'::text])),
  CONSTRAINT data_export_subject_check CHECK (
    (kind = 'self' AND subject_user_id IS NOT NULL AND student_id IS NULL)
    OR (kind <> 'self' AND student_id IS NOT NULL AND school_id IS NOT NULL)
  ),
  CONSTRAINT data_export_requested_by_fkey FOREIGN KEY (requested_by)
    REFERENCES public.user_profile (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT data_export_subject_user_id_fkey FOREIGN KEY (subject_user_id)
    REFERENCES public.user_profile (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT data_export_student_id_fkey FOREIGN KEY (student_id)
    REFERENCES student.student (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT data_export_school_id_fkey FOREIGN KEY (school_id)
    REFERENCES public.school (id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX data_export_requested_by_idx ON compliance.data_export (requested_by, created_at DESC);
CREATE INDEX data_export_student_id_idx ON compliance.data_export (student_id);
CREATE INDEX data_export_subject_user_id_idx ON compliance.data_export (subject_user_id);
CREATE INDEX data_export_expires_idx ON compliance.data_export (expires_at) WHERE (status = 'ready'::text);
CREATE INDEX data_export_status_idx ON compliance.data_export (status, updated_at);
CREATE UNIQUE INDEX data_export_one_active_key
  ON compliance.data_export (requested_by, kind, COALESCE(student_id, subject_user_id))
  WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));

ALTER TABLE student.pastoral_note
  ADD COLUMN sar_withheld boolean NOT NULL DEFAULT false,
  ADD COLUMN sar_withheld_reason text,
  ADD COLUMN sar_withheld_by uuid,
  ADD COLUMN sar_withheld_at timestamptz,
  ADD CONSTRAINT pastoral_note_sar_withheld_reason_check CHECK (
    (NOT sar_withheld) OR (sar_withheld_reason IS NOT NULL AND length(btrim(sar_withheld_reason)) BETWEEN 1 AND 2000)
  );
