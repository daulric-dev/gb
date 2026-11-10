-- Similarity check on text submissions (src/similarity), behind the
-- `similarity_check` feature (off by default). Fingerprints of each text
-- part of a submission, the directed matches between them, and a school's
-- settings. Teachers only; deleted with the submission.

CREATE TABLE grading.similarity_fingerprint (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    part text DEFAULT ''::text NOT NULL,
    activity_id uuid NOT NULL,
    course_id uuid NOT NULL,
    school_id uuid NOT NULL,
    word_count integer NOT NULL,
    hashes integer[] NOT NULL,
    text_hash text NOT NULL,
    computed_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT similarity_fingerprint_pkey PRIMARY KEY (id),
    CONSTRAINT similarity_fingerprint_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES grading.submission(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX similarity_fingerprint_submission_part_key ON grading.similarity_fingerprint USING btree (submission_id, part);
CREATE INDEX idx_similarity_fingerprint_activity ON grading.similarity_fingerprint USING btree (activity_id, part);
CREATE INDEX idx_similarity_fingerprint_school ON grading.similarity_fingerprint USING btree (school_id);
-- Candidate pairs: fingerprints sharing any hash (hashes && $1).
CREATE INDEX idx_similarity_fingerprint_hashes ON grading.similarity_fingerprint USING gin (hashes);

CREATE TABLE grading.similarity_match (
    fingerprint_id uuid NOT NULL,
    other_id uuid NOT NULL,
    score numeric(5,2) NOT NULL,
    shared integer NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT similarity_match_pkey PRIMARY KEY (fingerprint_id, other_id),
    CONSTRAINT similarity_match_fingerprint_id_fkey FOREIGN KEY (fingerprint_id) REFERENCES grading.similarity_fingerprint(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT similarity_match_other_id_fkey FOREIGN KEY (other_id) REFERENCES grading.similarity_fingerprint(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT similarity_match_score_check CHECK (score >= 0 AND score <= 100),
    CONSTRAINT similarity_match_not_self_check CHECK (fingerprint_id <> other_id)
);

CREATE INDEX idx_similarity_match_other ON grading.similarity_match USING btree (other_id);

CREATE TABLE grading.similarity_setting (
    school_id uuid NOT NULL,
    pool text DEFAULT 'activity'::text NOT NULL,
    pool_terms integer DEFAULT 2 NOT NULL,
    threshold integer DEFAULT 40 NOT NULL,
    updated_by uuid,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT similarity_setting_pkey PRIMARY KEY (school_id),
    CONSTRAINT similarity_setting_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT similarity_setting_pool_check CHECK (pool = ANY (ARRAY['activity'::text, 'school'::text])),
    CONSTRAINT similarity_setting_pool_terms_check CHECK (pool_terms BETWEEN 1 AND 12),
    CONSTRAINT similarity_setting_threshold_check CHECK (threshold BETWEEN 10 AND 100)
);
