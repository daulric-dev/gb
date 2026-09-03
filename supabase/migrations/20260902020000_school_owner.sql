-- Track the school owner explicitly so administrators can manage other
-- members without being able to remove the account that owns the school.

ALTER TABLE public.school
  ADD COLUMN IF NOT EXISTS owner_id uuid;

ALTER TABLE public.school
  DROP CONSTRAINT IF EXISTS school_owner_id_fkey;

ALTER TABLE public.school
  ADD CONSTRAINT school_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.user_profile(id) ON DELETE RESTRICT;

-- Existing schools have no recorded creator. Use the earliest admin
-- membership as a deterministic one-time backfill.
UPDATE public.school s
SET owner_id = owners.user_id
FROM (
  SELECT DISTINCT ON (school_id) school_id, user_id
  FROM public.school_management
  WHERE role = 'admin'
  ORDER BY school_id, created_at ASC, id ASC
) owners
WHERE s.id = owners.school_id
  AND s.owner_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_school_owner ON public.school(owner_id);
