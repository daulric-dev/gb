-- School feature opt-outs are a relation so this setting does not depend on
-- PostgreSQL scalar arrays.
-- Bridge: idempotent. A development database that ran `prisma db push` on
-- this branch before the bridge existed can already be in the target shape
-- (new table present, old array column gone) without this migration being
-- recorded; each step below checks the current shape first.

CREATE TABLE IF NOT EXISTS public.school_feature_disabled (
    school_id uuid NOT NULL,
    feature text NOT NULL,
    CONSTRAINT school_feature_disabled_pkey PRIMARY KEY (school_id, feature),
    CONSTRAINT school_feature_disabled_school_fkey FOREIGN KEY (school_id)
        REFERENCES public.school(id) ON DELETE CASCADE
);

DO $bridge$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school' AND column_name = 'disabled_features') THEN
    INSERT INTO public.school_feature_disabled (school_id, feature)
    SELECT DISTINCT school.id, selected.feature
    FROM public.school AS school
    CROSS JOIN LATERAL unnest(school.disabled_features) AS selected(feature)
    ON CONFLICT DO NOTHING;
    ALTER TABLE public.school DROP COLUMN disabled_features;
  END IF;
END
$bridge$;
