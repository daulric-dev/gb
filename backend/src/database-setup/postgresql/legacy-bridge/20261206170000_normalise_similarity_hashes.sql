-- Store each fingerprint hash as a portable indexed row instead of a PostgreSQL array.
-- Bridge: idempotent. A development database that ran `prisma db push` on
-- this branch before the bridge existed can already be in the target shape
-- (new table present, old array column gone) without this migration being
-- recorded; each step below checks the current shape first.

CREATE TABLE IF NOT EXISTS grading.similarity_fingerprint_hash (
    fingerprint_id uuid NOT NULL,
    hash integer NOT NULL,
    CONSTRAINT similarity_fingerprint_hash_pkey PRIMARY KEY (fingerprint_id, hash),
    CONSTRAINT similarity_fingerprint_hash_fingerprint_id_fkey
        FOREIGN KEY (fingerprint_id) REFERENCES grading.similarity_fingerprint(id)
        ON DELETE CASCADE ON UPDATE NO ACTION
);

DO $bridge$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'grading' AND table_name = 'similarity_fingerprint' AND column_name = 'hashes') THEN
    INSERT INTO grading.similarity_fingerprint_hash (fingerprint_id, hash)
    SELECT f.id, h.hash
    FROM grading.similarity_fingerprint AS f
    CROSS JOIN LATERAL unnest(f.hashes) AS h(hash)
    ON CONFLICT DO NOTHING;
    DROP INDEX IF EXISTS grading.idx_similarity_fingerprint_hashes;
    ALTER TABLE grading.similarity_fingerprint DROP COLUMN hashes;
  END IF;
END
$bridge$;

CREATE INDEX IF NOT EXISTS idx_similarity_fingerprint_hash_value
    ON grading.similarity_fingerprint_hash (hash, fingerprint_id);

CREATE TABLE IF NOT EXISTS grading.similarity_school_lock (
    school_id uuid NOT NULL,
    revision integer NOT NULL DEFAULT 0,
    CONSTRAINT similarity_school_lock_pkey PRIMARY KEY (school_id),
    CONSTRAINT similarity_school_lock_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.school(id)
        ON DELETE CASCADE ON UPDATE NO ACTION
);
