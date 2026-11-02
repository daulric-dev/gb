-- Invites for people who have no GradeBook account yet.
--
-- An organisation admin who appoints a school's admin, or adds an
-- organisation admin, by an email nobody signs in with yet gets an invite
-- instead of a 404. The first sign-in that proves that email (an email code,
-- or an SSO provider that vouches for it) applies every open, unexpired
-- invite for it: see src/organisation/invite.service.ts.
--
-- organisation_invite
--   email        lower-cased and trimmed (as account.app_user.email).
--   kind         school_admin (school_id required) or organisation_admin
--                (school_id null).
--   expires_at   14 days after it was sent (or last resent).
--   accepted_at  set with accepted_by when it is applied.
--   revoked_at   set when cancelled, or replaced by a newer invite or a
--                direct appointment.
--
-- "Open" = accepted_at IS NULL AND revoked_at IS NULL. A school has one
-- admin, so it has at most one open school_admin invite; an email has at most
-- one open organisation_admin invite. Together these make (kind, school_id,
-- email) unique among open invites.

--
-- Name: organisation_invite; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organisation_invite (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    kind text NOT NULL,
    school_id uuid,
    invited_by uuid,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(6) with time zone DEFAULT (CURRENT_TIMESTAMP + '14 days'::interval) NOT NULL,
    accepted_at timestamp(6) with time zone,
    accepted_by uuid,
    revoked_at timestamp(6) with time zone,
    CONSTRAINT organisation_invite_pkey PRIMARY KEY (id),
    CONSTRAINT organisation_invite_kind_check CHECK ((kind = ANY (ARRAY['school_admin'::text, 'organisation_admin'::text]))),
    CONSTRAINT organisation_invite_school_check CHECK (((kind = 'school_admin'::text) = (school_id IS NOT NULL))),
    CONSTRAINT organisation_invite_email_check CHECK (((email = lower(btrim(email))) AND (char_length(email) BETWEEN 3 AND 320))),
    CONSTRAINT organisation_invite_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE,
    CONSTRAINT organisation_invite_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.user_profile(id) ON DELETE SET NULL,
    CONSTRAINT organisation_invite_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.user_profile(id) ON DELETE SET NULL
);


--
-- One open school_admin invite per school; one open organisation_admin
-- invite per email.
--

CREATE UNIQUE INDEX organisation_invite_open_school_admin ON public.organisation_invite USING btree (school_id)
    WHERE ((kind = 'school_admin'::text) AND (accepted_at IS NULL) AND (revoked_at IS NULL));

CREATE UNIQUE INDEX organisation_invite_open_organisation_admin ON public.organisation_invite USING btree (email)
    WHERE ((kind = 'organisation_admin'::text) AND (accepted_at IS NULL) AND (revoked_at IS NULL));

-- Sign-in looks up the open invites for an email.
CREATE INDEX organisation_invite_open_email_idx ON public.organisation_invite USING btree (email)
    WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));

CREATE INDEX organisation_invite_invited_by_idx ON public.organisation_invite USING btree (invited_by);

CREATE INDEX organisation_invite_accepted_by_idx ON public.organisation_invite USING btree (accepted_by);
