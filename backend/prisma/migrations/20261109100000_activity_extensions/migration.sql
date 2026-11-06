-- Per-student due date extensions. A student's effective due date on an
-- activity is their extension's due_at when one exists, else the activity's.
CREATE TABLE grading.activity_extension (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  student_id uuid NOT NULL,
  due_at timestamp(6) with time zone NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT activity_extension_pkey PRIMARY KEY (id),
  CONSTRAINT activity_extension_activity_id_fkey
    FOREIGN KEY (activity_id) REFERENCES grading.activity(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT activity_extension_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES student.student(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT activity_extension_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.user_profile(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT activity_extension_reason_length_check
    CHECK (reason IS NULL OR char_length(reason) <= 500)
);

CREATE UNIQUE INDEX activity_extension_activity_student_key
  ON grading.activity_extension USING btree (activity_id, student_id);
CREATE INDEX idx_activity_extension_student
  ON grading.activity_extension USING btree (student_id);
CREATE INDEX idx_activity_extension_created_by
  ON grading.activity_extension USING btree (created_by);
