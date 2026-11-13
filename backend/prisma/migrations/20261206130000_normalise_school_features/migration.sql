-- School feature opt-outs are a relation so this setting does not depend on
-- PostgreSQL scalar arrays.
CREATE TABLE public.school_feature_disabled (
    school_id uuid NOT NULL,
    feature text NOT NULL,
    CONSTRAINT school_feature_disabled_pkey PRIMARY KEY (school_id, feature),
    CONSTRAINT school_feature_disabled_school_fkey FOREIGN KEY (school_id)
        REFERENCES public.school(id) ON DELETE CASCADE
);

INSERT INTO public.school_feature_disabled (school_id, feature)
SELECT DISTINCT school.id, selected.feature
FROM public.school AS school
CROSS JOIN LATERAL unnest(school.disabled_features) AS selected(feature);

ALTER TABLE public.school DROP COLUMN disabled_features;
