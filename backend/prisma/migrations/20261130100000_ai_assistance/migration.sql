-- AI assistance (src/ai, ROADMAP item 17), behind the ai_assistance feature
-- (off by default; the organisation turns it on, a school can switch it off).
--
-- The organisation brings its own AI provider (Anthropic or any
-- OpenAI-compatible endpoint). API keys are encrypted by the API
-- (src/account/secret-box.ts) and never returned. Teachers ask for drafts
-- (quiz questions, rubric feedback suggestions, page summaries); nothing the
-- model returns is written anywhere until a teacher accepts it through the
-- normal routes. Every request is logged in public.ai_request without its
-- prompt or output unless the organisation turns on keep_prompts (30 days).

CREATE TABLE public.ai_provider (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL,
  base_url text,
  model text NOT NULL,
  api_key_enc text NOT NULL,
  api_key_last4 text NOT NULL,
  monthly_cap integer,
  is_default boolean NOT NULL DEFAULT false,
  -- The organisation runs this provider on its own private network (local
  -- Ollama / vLLM): only then may its base URL be http or resolve to a
  -- private / loopback address. Independent of WEBHOOK_ALLOW_PRIVATE.
  allow_private_network boolean NOT NULL DEFAULT false,
  -- Schools may choose it in their AI settings (and use it as the default).
  available_to_schools boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_pkey PRIMARY KEY (id),
  CONSTRAINT ai_provider_kind_check CHECK (kind IN ('anthropic', 'openai_compatible')),
  CONSTRAINT ai_provider_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT ai_provider_model_check CHECK (char_length(btrim(model)) BETWEEN 1 AND 200),
  -- An OpenAI-compatible provider has no default endpoint.
  CONSTRAINT ai_provider_base_url_check CHECK (kind <> 'openai_compatible' OR base_url IS NOT NULL),
  CONSTRAINT ai_provider_monthly_cap_check CHECK (monthly_cap IS NULL OR monthly_cap > 0)
);
-- At most one default provider.
CREATE UNIQUE INDEX ai_provider_one_default ON public.ai_provider USING btree (is_default) WHERE is_default;

CREATE TABLE public.ai_org_setting (
  id boolean NOT NULL DEFAULT true,
  keep_prompts boolean NOT NULL DEFAULT false,
  user_hourly_limit integer NOT NULL DEFAULT 30,
  updated_by uuid,
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_org_setting_pkey PRIMARY KEY (id),
  CONSTRAINT ai_org_setting_singleton CHECK (id),
  CONSTRAINT ai_org_setting_user_hourly_limit_check CHECK (user_hourly_limit BETWEEN 1 AND 1000)
);

CREATE TABLE public.ai_school_setting (
  school_id uuid NOT NULL,
  allow_student_work boolean NOT NULL DEFAULT false,
  -- The school's choice among the organisation's providers; null = the
  -- organisation default. Schools never add providers or keys.
  provider_id uuid,
  updated_by uuid,
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_school_setting_pkey PRIMARY KEY (school_id),
  CONSTRAINT ai_school_setting_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES public.school(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT ai_school_setting_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES public.ai_provider(id)
    ON DELETE SET NULL ON UPDATE NO ACTION
);
CREATE INDEX idx_ai_school_setting_provider ON public.ai_school_setting USING btree (provider_id);

CREATE TABLE public.ai_request (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  school_id uuid,
  course_id uuid,
  feature text NOT NULL,
  provider_id uuid,
  provider_name text NOT NULL,
  provider_kind text NOT NULL,
  model text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  prompt_text text,
  response_text text,
  prompt_expires_at timestamp(6) with time zone,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_request_pkey PRIMARY KEY (id),
  CONSTRAINT ai_request_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES public.ai_provider(id)
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT ai_request_feature_check CHECK (feature IN ('quiz_questions', 'rubric_feedback', 'page_summary', 'test')),
  CONSTRAINT ai_request_status_check CHECK (status IN
    ('pending', 'ok', 'refused', 'truncated', 'invalid_output', 'error', 'rate_limited', 'cap_reached')),
  -- Stored prompts always carry their expiry.
  CONSTRAINT ai_request_prompt_expiry_check CHECK (
    (prompt_text IS NULL AND response_text IS NULL) OR prompt_expires_at IS NOT NULL)
);
CREATE INDEX idx_ai_request_user ON public.ai_request USING btree (user_id, created_at);
CREATE INDEX idx_ai_request_provider ON public.ai_request USING btree (provider_id, created_at);
CREATE INDEX idx_ai_request_created ON public.ai_request USING btree (created_at);
