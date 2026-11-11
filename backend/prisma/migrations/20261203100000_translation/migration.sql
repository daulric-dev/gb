-- Machine translation (src/translation), behind the translation feature
-- (off by default; the organisation turns it on, a school can switch it off).
--
-- One row at most: the organisation's translation engine. The engine's API
-- key (DeepL, Yandex, an optional LibreTranslate key) is encrypted by the API
-- (src/account/secret-box.ts) and never returned. No translated text is
-- stored here: translations are cached (Redis or memory) for 30 days, keyed
-- by a hash of the engine, URL, languages and text.

CREATE TABLE public.translation_setting (
  id boolean NOT NULL DEFAULT true,
  engine text NOT NULL DEFAULT 'google',
  -- LibreTranslate only: the server's address (self-hosted or a provider).
  url text,
  key_enc text,
  -- The LibreTranslate server runs on the organisation's private network:
  -- only then may its URL be http or resolve to a private / loopback
  -- address. Independent of WEBHOOK_ALLOW_PRIVATE.
  allow_private_network boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT translation_setting_pkey PRIMARY KEY (id),
  CONSTRAINT translation_setting_singleton CHECK (id),
  CONSTRAINT translation_setting_engine_check CHECK (engine IN ('google', 'deepl', 'libre', 'yandex')),
  -- Only LibreTranslate is reached at an organisation-chosen address.
  CONSTRAINT translation_setting_url_check CHECK (url IS NULL OR (engine = 'libre' AND char_length(url) BETWEEN 1 AND 2000))
);
