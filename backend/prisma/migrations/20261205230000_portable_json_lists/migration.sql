-- These lists are opaque result details: store them as JSON rather than as
-- PostgreSQL-only scalar arrays.
ALTER TABLE course.library_import
    ALTER COLUMN notes DROP DEFAULT,
    ALTER COLUMN notes TYPE jsonb USING to_jsonb(notes),
    ALTER COLUMN notes SET DEFAULT '[]'::jsonb;

ALTER TABLE public.roster_change
    ALTER COLUMN errors DROP DEFAULT,
    ALTER COLUMN errors TYPE jsonb USING to_jsonb(errors),
    ALTER COLUMN errors SET DEFAULT '[]'::jsonb;
