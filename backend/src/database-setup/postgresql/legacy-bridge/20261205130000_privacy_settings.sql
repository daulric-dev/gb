-- The organisation's privacy notice details (src/privacy). One row at most:
-- the organisation that runs the install is the controller, and these fill
-- the placeholders of the public privacy notice (GET /api/privacy/notice,
-- web /privacy). Every field is optional; until the controller name, a
-- privacy contact and the supervisory authority are set, the notice and the
-- organisation console show that it is incomplete.
--
-- No personal data beyond what a controller publishes about itself (the DPO
-- contact) and updated_by (no foreign key: the row outlives the account).

CREATE TABLE public.privacy_setting (
  id boolean NOT NULL DEFAULT true,
  controller_name text,
  controller_address text,
  privacy_email text,
  dpo_name text,
  dpo_email text,
  supervisory_authority_name text,
  supervisory_authority_url text,
  data_location text,
  -- { purposeKey: basisKey }, overriding the defaults for schools.
  lawful_bases jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{ name, purpose, location }]: processors the API cannot detect itself.
  additional_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT privacy_setting_pkey PRIMARY KEY (id),
  CONSTRAINT privacy_setting_singleton CHECK (id),
  CONSTRAINT privacy_setting_lawful_bases_object CHECK (jsonb_typeof(lawful_bases) = 'object'),
  CONSTRAINT privacy_setting_recipients_array CHECK (
    jsonb_typeof(additional_recipients) = 'array' AND jsonb_array_length(additional_recipients) <= 30
  ),
  CONSTRAINT privacy_setting_text_lengths CHECK (
    char_length(coalesce(controller_name, '')) <= 200
    AND char_length(coalesce(controller_address, '')) <= 500
    AND char_length(coalesce(privacy_email, '')) <= 254
    AND char_length(coalesce(dpo_name, '')) <= 200
    AND char_length(coalesce(dpo_email, '')) <= 254
    AND char_length(coalesce(supervisory_authority_name, '')) <= 200
    AND char_length(coalesce(supervisory_authority_url, '')) <= 500
    AND char_length(coalesce(data_location, '')) <= 200
  )
);
