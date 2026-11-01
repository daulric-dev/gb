-- School logo.
--
-- The key of the school's logo inside the `images` storage area
-- (`school-logos/<school id>-<random>.<ext>`). Null: no logo, clients show
-- the app mark.

ALTER TABLE public.school
    ADD COLUMN IF NOT EXISTS logo_path text;
