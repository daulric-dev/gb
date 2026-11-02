-- More kinds of school than primary and secondary. ADD VALUE is safe inside
-- the migration's transaction because nothing here uses the new values.

ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'preschool';
ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'middle';
ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'all_through';
ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'sixth_form';
ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'college';
ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'university';
ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'vocational';
ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'special_education';
ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'online';
ALTER TYPE public.schooltype ADD VALUE IF NOT EXISTS 'other';
