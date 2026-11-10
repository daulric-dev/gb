-- Course template library (src/course/library-*.ts, ROADMAP item 13).
--
-- A library item is a course, or chosen modules, quizzes, rubrics and pages,
-- published for the publisher's school or the whole organisation. Every
-- publish is an immutable version: a JSON snapshot of the design plus copies
-- of its files in storage under course-library/<item>/<version>/, so neither
-- the library nor an importer ever points at the author's own files.
-- Importing copies those files again into the importer's file-manager
-- storage, as a background job (library_import) with progress.
--
-- New permission course-library:create (organisation-wide publishing) is
-- inserted by the boot-time catalog sync; nobody held a key for this before,
-- so no role grants are needed (admins hold every key in code).

CREATE TABLE course.library_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  source_course_id uuid,
  title text NOT NULL,
  description text,
  subject text,
  grade_level text,
  tags text[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'school',
  latest_version integer NOT NULL DEFAULT 0,
  created_by uuid,
  unpublished_at timestamp(6) with time zone,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT library_item_pkey PRIMARY KEY (id),
  CONSTRAINT library_item_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT library_item_source_course_id_fkey
    FOREIGN KEY (source_course_id) REFERENCES course.course(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT library_item_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT library_item_visibility_check CHECK (visibility IN ('school', 'organisation')),
  CONSTRAINT library_item_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT library_item_tags_check CHECK (cardinality(tags) <= 20)
);
CREATE INDEX idx_library_item_school ON course.library_item USING btree (school_id, visibility);
CREATE INDEX idx_library_item_visibility ON course.library_item USING btree (visibility) WHERE (unpublished_at IS NULL);
CREATE INDEX idx_library_item_source_course ON course.library_item USING btree (source_course_id);

CREATE TABLE course.library_item_version (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  version integer NOT NULL,
  content jsonb NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}',
  file_count integer NOT NULL DEFAULT 0,
  file_bytes bigint NOT NULL DEFAULT 0,
  note text,
  published_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT library_item_version_pkey PRIMARY KEY (id),
  CONSTRAINT library_item_version_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES course.library_item(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT library_item_version_published_by_fkey
    FOREIGN KEY (published_by) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX library_item_version_item_version_key ON course.library_item_version USING btree (item_id, version);

CREATE TABLE course.library_import (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  school_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  mode text NOT NULL,
  target_course_id uuid,
  options jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  files_total integer NOT NULL DEFAULT 0,
  files_done integer NOT NULL DEFAULT 0,
  bytes_total bigint NOT NULL DEFAULT 0,
  result jsonb,
  notes text[] NOT NULL DEFAULT '{}',
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  finished_at timestamp(6) with time zone,
  CONSTRAINT library_import_pkey PRIMARY KEY (id),
  CONSTRAINT library_import_version_id_fkey
    FOREIGN KEY (version_id) REFERENCES course.library_item_version(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT library_import_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT library_import_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES public.user_profile(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT library_import_target_course_id_fkey
    FOREIGN KEY (target_course_id) REFERENCES course.course(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT library_import_mode_check CHECK (mode IN ('append', 'new_course')),
  CONSTRAINT library_import_status_check CHECK (status IN ('queued', 'copying', 'done', 'failed')),
  CONSTRAINT library_import_progress_check CHECK (files_done >= 0 AND files_done <= files_total)
);
CREATE INDEX idx_library_import_requested_by ON course.library_import USING btree (requested_by, created_at DESC);
CREATE INDEX idx_library_import_active ON course.library_import USING btree (status, updated_at) WHERE (status = ANY (ARRAY['queued'::text, 'copying'::text]));
CREATE INDEX library_import_version_id_idx ON course.library_import USING btree (version_id);
CREATE INDEX library_import_school_id_idx ON course.library_import USING btree (school_id);
CREATE INDEX library_import_target_course_id_idx ON course.library_import USING btree (target_course_id);
