-- Integrations: per-webhook TLS certificate verification.
--
-- public.school_webhook
--   verify_tls    check the receiver's certificate on https URLs. On by
--                 default and for every existing webhook (what they did
--                 before). Off is for testing only: anyone between GradeBook
--                 and the receiver can read or change deliveries. Turning it
--                 off is audited (tls_verification_disabled) and emailed to
--                 the school's admins.
--   tls_ca_cert   optional PEM bundle of CA certificates trusted instead of
--                 the public roots, for internal servers with a private-CA or
--                 self-signed certificate (the safe alternative to turning
--                 verification off). Certificates only, at most 64 KB,
--                 checked and normalised by the API; public data, stored
--                 plain. The audit log records SHA-256 fingerprints, not PEM.
--
-- public.webhook_delivery
--   tls_verified  whether the last attempt checked the certificate: false
--                 when sent with verification off, null for plain http.
--
-- public.integration_audit_log.action gains tls_verification_disabled,
-- tls_verification_enabled and tls_ca_changed.

ALTER TABLE public.school_webhook
    ADD COLUMN verify_tls boolean DEFAULT true NOT NULL,
    ADD COLUMN tls_ca_cert text;

ALTER TABLE public.webhook_delivery
    ADD COLUMN tls_verified boolean;

ALTER TABLE public.integration_audit_log DROP CONSTRAINT integration_audit_log_action_check;
ALTER TABLE public.integration_audit_log
    ADD CONSTRAINT integration_audit_log_action_check CHECK ((action = ANY (ARRAY['webhook_created'::text, 'webhook_updated'::text, 'webhook_deleted'::text, 'webhook_enabled'::text, 'webhook_disabled'::text, 'webhook_auto_disabled'::text, 'secret_rotated'::text, 'test_sent'::text, 'delivery_redelivered'::text, 'tls_verification_disabled'::text, 'tls_verification_enabled'::text, 'tls_ca_changed'::text])));
