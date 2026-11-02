-- The organisation layer.
--
-- An install is self-hosted by one organisation, which may run several
-- schools. The organisation is created once, by the first-run setup
-- (POST /api/setup); until then GET /api/setup/status reports needsSetup.
--
-- organisation        the one organisation (singleton: a unique index on a
--                     constant allows a single row).
-- organisation_admin  who manages it: creates schools, appoints their admins.
--                     Accounts listed in ORG_ADMIN_EMAILS count too.
--
-- The hosted platform's operators (billing.platform_admin) become
-- organisation admins here; 20261102100100_drop_billing then removes billing.

--
-- Name: organisation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organisation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT organisation_pkey PRIMARY KEY (id),
    CONSTRAINT organisation_name_check CHECK ((char_length(btrim(name)) BETWEEN 1 AND 120))
);


--
-- Name: organisation_singleton; Type: INDEX; Schema: public; Owner: -
--
-- Every row indexes the same value, so a second row is a unique violation:
-- two setups racing each other cannot both succeed.
--

CREATE UNIQUE INDEX organisation_singleton ON public.organisation USING btree ((true));


--
-- Name: organisation_admin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organisation_admin (
    user_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by uuid,
    CONSTRAINT organisation_admin_pkey PRIMARY KEY (user_id),
    CONSTRAINT organisation_admin_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profile(id) ON DELETE CASCADE,
    CONSTRAINT organisation_admin_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL
);

CREATE INDEX organisation_admin_created_by_idx ON public.organisation_admin USING btree (created_by);


--
-- Platform admins carry over as organisation admins (those with a profile;
-- an account that never finished signing in has none).
--

DO $$
BEGIN
    IF to_regclass('billing.platform_admin') IS NOT NULL THEN
        INSERT INTO public.organisation_admin (user_id, created_at)
        SELECT pa.user_id, pa.created_at
        FROM billing.platform_admin pa
        JOIN public.user_profile up ON up.id = pa.user_id
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
END $$;
