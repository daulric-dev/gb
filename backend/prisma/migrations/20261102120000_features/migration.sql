-- Platform features the organisation switches on or off.
--
-- organisation.features      key -> boolean overrides of the defaults in
--                            src/features/feature.catalog.ts ({} = every
--                            default). Unknown keys are ignored.
-- school.disabled_features   keys the school's admin switched off. A school
--                            can only switch off what the organisation
--                            allows; it can never switch one on.
--
-- Effective for a school = the organisation's value AND not disabled by the
-- school AND every feature it requires is effective.

ALTER TABLE public.organisation
    ADD COLUMN features jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.organisation
    ADD CONSTRAINT organisation_features_object_check CHECK ((jsonb_typeof(features) = 'object'::text));

ALTER TABLE public.school
    ADD COLUMN disabled_features text[] DEFAULT '{}'::text[] NOT NULL;
