-- Report cards and transcripts (src/report-card). A report period is a term.
-- Teachers write one comment per student per course for a term; the head or
-- form tutor writes one per student; an admin publishes the term's reports
-- (report_release.published_at), and each student's PDF is generated into
-- object storage and tracked in report_document.

CREATE TYPE grading.report_comment_status AS ENUM ('draft', 'ready');
CREATE TYPE grading.report_document_status AS ENUM ('pending', 'ready', 'failed');

CREATE TABLE grading.report_release (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  term_id uuid NOT NULL,
  comment_deadline timestamp(6) with time zone,
  published_at timestamp(6) with time zone,
  published_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT report_release_pkey PRIMARY KEY (id),
  CONSTRAINT report_release_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_release_term_id_fkey
    FOREIGN KEY (term_id) REFERENCES public.term(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_release_published_by_fkey
    FOREIGN KEY (published_by) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX report_release_school_term_key
  ON grading.report_release USING btree (school_id, term_id);
CREATE INDEX idx_report_release_term
  ON grading.report_release USING btree (term_id);
CREATE INDEX idx_report_release_published_by
  ON grading.report_release USING btree (published_by);

CREATE TABLE grading.report_comment (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  term_id uuid NOT NULL,
  course_id uuid NOT NULL,
  student_id uuid NOT NULL,
  author_id uuid,
  body text NOT NULL DEFAULT '',
  status grading.report_comment_status NOT NULL DEFAULT 'draft',
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT report_comment_pkey PRIMARY KEY (id),
  CONSTRAINT report_comment_term_id_fkey
    FOREIGN KEY (term_id) REFERENCES public.term(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_comment_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES course.course(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_comment_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_comment_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT report_comment_body_length_check
    CHECK (char_length(body) <= 2000)
);

CREATE UNIQUE INDEX report_comment_term_course_student_key
  ON grading.report_comment USING btree (term_id, course_id, student_id);
CREATE INDEX idx_report_comment_course
  ON grading.report_comment USING btree (course_id);
CREATE INDEX idx_report_comment_student
  ON grading.report_comment USING btree (student_id);
CREATE INDEX idx_report_comment_author
  ON grading.report_comment USING btree (author_id);

CREATE TABLE grading.report_head_comment (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  term_id uuid NOT NULL,
  student_id uuid NOT NULL,
  author_id uuid,
  body text NOT NULL DEFAULT '',
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT report_head_comment_pkey PRIMARY KEY (id),
  CONSTRAINT report_head_comment_term_id_fkey
    FOREIGN KEY (term_id) REFERENCES public.term(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_head_comment_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_head_comment_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT report_head_comment_body_length_check
    CHECK (char_length(body) <= 2000)
);

CREATE UNIQUE INDEX report_head_comment_term_student_key
  ON grading.report_head_comment USING btree (term_id, student_id);
CREATE INDEX idx_report_head_comment_student
  ON grading.report_head_comment USING btree (student_id);
CREATE INDEX idx_report_head_comment_author
  ON grading.report_head_comment USING btree (author_id);

CREATE TABLE grading.report_document (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  term_id uuid NOT NULL,
  student_id uuid NOT NULL,
  status grading.report_document_status NOT NULL DEFAULT 'pending',
  storage_key text,
  byte_size integer,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  generated_at timestamp(6) with time zone,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT report_document_pkey PRIMARY KEY (id),
  CONSTRAINT report_document_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_document_term_id_fkey
    FOREIGN KEY (term_id) REFERENCES public.term(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_document_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT report_document_attempts_check CHECK (attempts >= 0),
  CONSTRAINT report_document_byte_size_check
    CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT report_document_error_length_check
    CHECK (error IS NULL OR char_length(error) <= 1000)
);

CREATE UNIQUE INDEX report_document_term_student_key
  ON grading.report_document USING btree (term_id, student_id);
CREATE INDEX idx_report_document_school_term
  ON grading.report_document USING btree (school_id, term_id);
CREATE INDEX idx_report_document_student
  ON grading.report_document USING btree (student_id);
