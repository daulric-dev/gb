-- Keep SSO and integration audit history when a school is removed. The
-- school_id is an historical UUID snapshot, like actor_id and webhook_id;
-- the daily retention job deletes these rows after AUDIT_LOG_RETENTION_DAYS.
ALTER TABLE public.sso_audit_log
    DROP CONSTRAINT sso_audit_log_school_id_fkey;

ALTER TABLE public.integration_audit_log
    DROP CONSTRAINT integration_audit_log_school_id_fkey;
