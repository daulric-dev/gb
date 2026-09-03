-- A member may keep custom roles without a built-in default role.
ALTER TABLE public.school_management
  ALTER COLUMN role DROP NOT NULL;
