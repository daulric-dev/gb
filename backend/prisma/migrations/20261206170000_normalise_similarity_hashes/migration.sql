-- Store each fingerprint hash as a portable indexed row instead of a PostgreSQL array.
CREATE TABLE grading.similarity_fingerprint_hash (
    fingerprint_id uuid NOT NULL,
    hash integer NOT NULL,
    CONSTRAINT similarity_fingerprint_hash_pkey PRIMARY KEY (fingerprint_id, hash),
    CONSTRAINT similarity_fingerprint_hash_fingerprint_id_fkey
        FOREIGN KEY (fingerprint_id) REFERENCES grading.similarity_fingerprint(id)
        ON DELETE CASCADE ON UPDATE NO ACTION
);

INSERT INTO grading.similarity_fingerprint_hash (fingerprint_id, hash)
SELECT f.id, h.hash
FROM grading.similarity_fingerprint AS f
CROSS JOIN LATERAL unnest(f.hashes) AS h(hash)
ON CONFLICT DO NOTHING;

CREATE INDEX idx_similarity_fingerprint_hash_value
    ON grading.similarity_fingerprint_hash (hash, fingerprint_id);

DROP INDEX IF EXISTS grading.idx_similarity_fingerprint_hashes;
ALTER TABLE grading.similarity_fingerprint DROP COLUMN hashes;

CREATE TABLE grading.similarity_school_lock (
    school_id uuid NOT NULL,
    revision integer NOT NULL DEFAULT 0,
    CONSTRAINT similarity_school_lock_pkey PRIMARY KEY (school_id),
    CONSTRAINT similarity_school_lock_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.school(id)
        ON DELETE CASCADE ON UPDATE NO ACTION
);
