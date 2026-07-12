-- Speed up student search. `findAll(search)` filters with
--   first_name ILIKE '%term%' OR last_name ILIKE '%term%'
-- and this leading-wildcard ILIKE cannot use a b-tree index, so every
-- (uncached, keystroke-driven) search forced a sequential scan of the school's
-- students. Trigram GIN indexes make these ILIKE predicates index-assisted.

CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";

CREATE INDEX IF NOT EXISTS "idx_student_first_name_trgm"
  ON "student"."student" USING gin ("first_name" "extensions"."gin_trgm_ops");

CREATE INDEX IF NOT EXISTS "idx_student_last_name_trgm"
  ON "student"."student" USING gin ("last_name" "extensions"."gin_trgm_ops");
