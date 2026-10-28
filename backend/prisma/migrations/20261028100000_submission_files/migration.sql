CREATE TABLE grading.submission_file (
  submission_id uuid NOT NULL,
  file_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT submission_file_pkey PRIMARY KEY (submission_id, file_id),
  CONSTRAINT submission_file_submission_id_fkey
    FOREIGN KEY (submission_id) REFERENCES grading.submission(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT submission_file_file_id_fkey
    FOREIGN KEY (file_id) REFERENCES file_manager.file(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX idx_submission_file_file
  ON grading.submission_file USING btree (file_id);
CREATE INDEX idx_submission_file_order
  ON grading.submission_file USING btree (submission_id, sort_order);

INSERT INTO grading.submission_file (submission_id, file_id)
SELECT id, file_id
FROM grading.submission
WHERE file_id IS NOT NULL
ON CONFLICT DO NOTHING;
