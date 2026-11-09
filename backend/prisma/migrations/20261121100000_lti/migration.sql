-- LTI 1.3 tool support (src/lti), behind the `lti` feature (off by default).
-- GradeBook is the platform: the organisation registers external tools,
-- teachers add them to modules as "external tool" items, and tools post
-- scores back through Assignment and Grade Services.
--
-- The new enum value is added here but never cast to in this migration (it
-- runs in one transaction, and a value added in a transaction cannot be used
-- until it commits), so the item-type check compares item_type as text.

ALTER TYPE course.module_item_type ADD VALUE IF NOT EXISTS 'external_tool';

ALTER TABLE course.module_item
    DROP CONSTRAINT module_item_target_matches_type;

ALTER TABLE course.module_item
    ADD CONSTRAINT module_item_target_matches_type CHECK (
CASE (item_type)::text
    WHEN 'page'::text THEN (page_id IS NOT NULL)
    WHEN 'activity'::text THEN (activity_id IS NOT NULL)
    WHEN 'file'::text THEN (file_id IS NOT NULL)
    WHEN 'link'::text THEN ((url IS NOT NULL) AND (title IS NOT NULL))
    WHEN 'header'::text THEN (title IS NOT NULL)
    WHEN 'discussion'::text THEN (discussion_topic_id IS NOT NULL)
    WHEN 'external_tool'::text THEN (title IS NOT NULL)
    ELSE NULL::boolean
END);

-- Platform signing keys. The private key is AES-256-GCM ciphertext
-- (src/account/secret-box.ts), never plaintext.
CREATE TABLE public.lti_platform_key (
    kid text NOT NULL,
    public_jwk jsonb NOT NULL,
    private_key_sealed text NOT NULL,
    active boolean DEFAULT false NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    retired_at timestamp(6) with time zone,
    CONSTRAINT lti_platform_key_pkey PRIMARY KEY (kid),
    CONSTRAINT lti_platform_key_jwk_object_check CHECK (jsonb_typeof(public_jwk) = 'object')
);

-- At most one active key.
CREATE UNIQUE INDEX lti_platform_key_one_active_key ON public.lti_platform_key USING btree (active) WHERE (active = true);

-- Tools registered by the organisation.
CREATE TABLE public.lti_tool (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    client_id text NOT NULL,
    login_url text NOT NULL,
    target_link_uri text NOT NULL,
    redirect_uris text[] NOT NULL,
    jwks_url text,
    public_key_pem text,
    ags_enabled boolean DEFAULT false NOT NULL,
    send_name boolean DEFAULT false NOT NULL,
    send_email boolean DEFAULT false NOT NULL,
    custom_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lti_tool_pkey PRIMARY KEY (id),
    CONSTRAINT lti_tool_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
    CONSTRAINT lti_tool_login_url_check CHECK (login_url ~ '^https?://' AND char_length(login_url) <= 2048),
    CONSTRAINT lti_tool_target_link_uri_check CHECK (target_link_uri ~ '^https?://' AND char_length(target_link_uri) <= 2048),
    CONSTRAINT lti_tool_redirect_uris_check CHECK (cardinality(redirect_uris) BETWEEN 1 AND 20),
    CONSTRAINT lti_tool_jwks_url_check CHECK (jwks_url IS NULL OR (jwks_url ~ '^https?://' AND char_length(jwks_url) <= 2048)),
    CONSTRAINT lti_tool_key_source_check CHECK (jwks_url IS NOT NULL OR public_key_pem IS NOT NULL),
    CONSTRAINT lti_tool_custom_params_object_check CHECK (jsonb_typeof(custom_params) = 'object')
);

CREATE UNIQUE INDEX lti_tool_client_id_key ON public.lti_tool USING btree (client_id);

-- Where a tool may be used: every school (school_id null, one per tool) or
-- one school.
CREATE TABLE public.lti_deployment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tool_id uuid NOT NULL,
    deployment_id text NOT NULL,
    school_id uuid,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lti_deployment_pkey PRIMARY KEY (id),
    CONSTRAINT lti_deployment_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.lti_tool(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_deployment_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX lti_deployment_tool_deployment_key ON public.lti_deployment USING btree (tool_id, deployment_id);
CREATE UNIQUE INDEX lti_deployment_tool_school_key ON public.lti_deployment USING btree (tool_id, school_id);
CREATE UNIQUE INDEX lti_deployment_tool_all_schools_key ON public.lti_deployment USING btree (tool_id) WHERE (school_id IS NULL);
CREATE INDEX lti_deployment_school_id_idx ON public.lti_deployment USING btree (school_id);

-- External tool module items (resource links).
CREATE TABLE public.lti_resource_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tool_id uuid NOT NULL,
    deployment_id uuid NOT NULL,
    course_id uuid NOT NULL,
    module_item_id uuid NOT NULL,
    custom_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lti_resource_link_pkey PRIMARY KEY (id),
    CONSTRAINT lti_resource_link_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.lti_tool(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT lti_resource_link_deployment_id_fkey FOREIGN KEY (deployment_id) REFERENCES public.lti_deployment(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT lti_resource_link_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_resource_link_module_item_id_fkey FOREIGN KEY (module_item_id) REFERENCES course.module_item(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_resource_link_custom_params_object_check CHECK (jsonb_typeof(custom_params) = 'object')
);

CREATE UNIQUE INDEX lti_resource_link_module_item_key ON public.lti_resource_link USING btree (module_item_id);
CREATE INDEX lti_resource_link_tool_id_idx ON public.lti_resource_link USING btree (tool_id);
CREATE INDEX lti_resource_link_deployment_id_idx ON public.lti_resource_link USING btree (deployment_id);
CREATE INDEX lti_resource_link_course_id_idx ON public.lti_resource_link USING btree (course_id);

-- AGS line items: one gradebook activity each.
CREATE TABLE public.lti_line_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tool_id uuid NOT NULL,
    course_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    resource_link_id uuid,
    tag text,
    resource_id text,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lti_line_item_pkey PRIMARY KEY (id),
    CONSTRAINT lti_line_item_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.lti_tool(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_line_item_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_line_item_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES grading.activity(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_line_item_resource_link_id_fkey FOREIGN KEY (resource_link_id) REFERENCES public.lti_resource_link(id) ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT lti_line_item_tag_check CHECK (tag IS NULL OR char_length(tag) <= 256),
    CONSTRAINT lti_line_item_resource_id_check CHECK (resource_id IS NULL OR char_length(resource_id) <= 256)
);

CREATE UNIQUE INDEX lti_line_item_activity_key ON public.lti_line_item USING btree (activity_id);
CREATE INDEX lti_line_item_tool_id_course_id_idx ON public.lti_line_item USING btree (tool_id, course_id);
CREATE INDEX lti_line_item_course_id_idx ON public.lti_line_item USING btree (course_id);
CREATE INDEX lti_line_item_resource_link_id_idx ON public.lti_line_item USING btree (resource_link_id);

-- Pairwise user ids: the row id is the `sub` one tool sees for one user.
CREATE TABLE public.lti_subject (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tool_id uuid NOT NULL,
    user_profile_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lti_subject_pkey PRIMARY KEY (id),
    CONSTRAINT lti_subject_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.lti_tool(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_subject_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX lti_subject_tool_user_key ON public.lti_subject USING btree (tool_id, user_profile_id);
CREATE INDEX lti_subject_user_profile_id_idx ON public.lti_subject USING btree (user_profile_id);

-- Launches in progress (single-use lti_message_hint; SHA-256 only).
CREATE TABLE public.lti_launch (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    tool_id uuid NOT NULL,
    resource_link_id uuid NOT NULL,
    user_profile_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    roles text[] NOT NULL,
    expires_at timestamp(6) with time zone NOT NULL,
    used_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lti_launch_pkey PRIMARY KEY (id),
    CONSTRAINT lti_launch_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.lti_tool(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_launch_resource_link_id_fkey FOREIGN KEY (resource_link_id) REFERENCES public.lti_resource_link(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX lti_launch_token_hash_key ON public.lti_launch USING btree (token_hash);
CREATE INDEX lti_launch_expires_at_idx ON public.lti_launch USING btree (expires_at);
CREATE INDEX lti_launch_tool_id_idx ON public.lti_launch USING btree (tool_id);
CREATE INDEX lti_launch_resource_link_id_idx ON public.lti_launch USING btree (resource_link_id);

-- Replay protection for id_token nonces and client-assertion jti values.
CREATE TABLE public.lti_replay (
    tool_id uuid NOT NULL,
    kind text NOT NULL,
    value text NOT NULL,
    expires_at timestamp(6) with time zone NOT NULL,
    CONSTRAINT lti_replay_pkey PRIMARY KEY (tool_id, kind, value),
    CONSTRAINT lti_replay_kind_check CHECK (kind IN ('nonce', 'jti')),
    CONSTRAINT lti_replay_value_check CHECK (char_length(value) <= 512)
);

CREATE INDEX lti_replay_expires_at_idx ON public.lti_replay USING btree (expires_at);

-- AGS access tokens (SHA-256 only).
CREATE TABLE public.lti_access_token (
    token_hash text NOT NULL,
    tool_id uuid NOT NULL,
    scopes text[] NOT NULL,
    expires_at timestamp(6) with time zone NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lti_access_token_pkey PRIMARY KEY (token_hash),
    CONSTRAINT lti_access_token_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.lti_tool(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX lti_access_token_tool_id_idx ON public.lti_access_token USING btree (tool_id);
CREATE INDEX lti_access_token_expires_at_idx ON public.lti_access_token USING btree (expires_at);

-- The last score each tool posted per user and line item (AGS ordering).
CREATE TABLE public.lti_score (
    line_item_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    "timestamp" timestamp(6) with time zone NOT NULL,
    activity_progress text NOT NULL,
    grading_progress text NOT NULL,
    score_given numeric,
    score_maximum numeric,
    written boolean DEFAULT false NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lti_score_pkey PRIMARY KEY (line_item_id, subject_id),
    CONSTRAINT lti_score_line_item_id_fkey FOREIGN KEY (line_item_id) REFERENCES public.lti_line_item(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_score_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.lti_subject(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT lti_score_activity_progress_check CHECK (activity_progress IN ('Initialized', 'Started', 'InProgress', 'Submitted', 'Completed')),
    CONSTRAINT lti_score_grading_progress_check CHECK (grading_progress IN ('FullyGraded', 'Pending', 'PendingManual', 'Failed', 'NotReady'))
);

CREATE INDEX lti_score_subject_id_idx ON public.lti_score USING btree (subject_id);
