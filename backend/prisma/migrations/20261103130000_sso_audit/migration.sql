-- Guarding single sign-on settings.
--
-- Whoever edits a school's SSO configuration (a domain's provider, its SAML
-- identity provider, the school's own OAuth apps) can point a domain at an
-- identity provider they control and sign in as anyone on it. Three things
-- make that visible and harder:
--
-- public.sso_audit_log      one row per change, written in the same
--                           transaction as the change itself.
--   school_id     the school (cascades: a deleted school takes its log).
--   domain_id     the email domain, when the change is about one. No
--                 foreign key: the entry outlives the domain.
--   domain        the domain name, kept for the same reason.
--   actor_id      who made it (no foreign key: the entry outlives the
--                 account; null for the system).
--   actor_via     school_admin | organisation_admin: which console.
--   action        what happened (see the CHECK).
--   changes       { field: { before, after } } plus context. Never a
--                 secret: certificates are SHA-256 fingerprints, client
--                 secrets only "set" / "cleared".
--
-- account.session.elevated_until  a step-up confirmation (an emailed code
--                 entered while signed in) lets this session change SSO
--                 settings until then. Null: not confirmed.
--
-- account.email_code.purpose      sign_in | step_up. A code only works for
--                 the purpose it was sent for, so a sign-in code cannot
--                 confirm a change and a step-up code cannot sign in.

CREATE TABLE public.sso_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    domain_id uuid,
    domain text,
    actor_id uuid,
    actor_via text NOT NULL,
    action text NOT NULL,
    changes jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sso_audit_log_pkey PRIMARY KEY (id),
    CONSTRAINT sso_audit_log_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE,
    CONSTRAINT sso_audit_log_actor_via_check CHECK ((actor_via = ANY (ARRAY['school_admin'::text, 'organisation_admin'::text]))),
    CONSTRAINT sso_audit_log_action_check CHECK ((action = ANY (ARRAY['domain_added'::text, 'domain_removed'::text, 'domain_verified'::text, 'domain_settings_changed'::text, 'provider_changed'::text, 'sso_required_changed'::text, 'saml_changed'::text, 'azure_tenant_changed'::text, 'app_changed'::text, 'app_secret_changed'::text, 'app_enabled'::text, 'app_disabled'::text]))),
    CONSTRAINT sso_audit_log_changes_object_check CHECK ((jsonb_typeof(changes) = 'object'::text))
);

CREATE INDEX sso_audit_log_school_created_idx ON public.sso_audit_log USING btree (school_id, created_at DESC, id DESC);

ALTER TABLE account.session ADD COLUMN elevated_until timestamp with time zone;

ALTER TABLE account.email_code ADD COLUMN purpose text DEFAULT 'sign_in'::text NOT NULL;
ALTER TABLE account.email_code ADD CONSTRAINT email_code_purpose_check CHECK ((purpose = ANY (ARRAY['sign_in'::text, 'step_up'::text])));
