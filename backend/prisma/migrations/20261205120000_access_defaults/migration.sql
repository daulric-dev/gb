-- Access defaults, audit tamper-evidence and encrypted student text
-- (src/permission, src/audit-log, src/pastoral, src/grading accommodations).
--
-- 1. New permission actions: student:read-all, student:sensitive,
--    student:export, student:erase (EXTRA_ACTIONS in
--    src/permission/permission.catalog.ts). The CHECK is widened and the
--    catalog rows inserted here (the boot sync adds them too, after
--    migrations).
--
-- Role defaults change in code, not here: the system roles (admin, teacher,
-- member) hold no school_role_permission rows, they report ROLE_DEFAULTS.
-- After this release:
--   * admin: every key except pastoral-note:safeguarding (now explicit-only);
--     organisation admins likewise. This migration does NOT grant
--     safeguarding to anyone: a school gives it to a custom role on the
--     Roles page (step-up, audit-logged) and assigns that role.
--   * teacher: student:read, now limited to the students in their own
--     courses and their tutees (no read-all).
--   * member: no student:read.
-- Custom roles are left exactly as they are. A custom role holding
-- student:read now sees only its holders' own students unless the school
-- also gives it student:read-all; the notices below count the roles to
-- review.
ALTER TABLE public.permission_catalog DROP CONSTRAINT permission_catalog_action_check;
ALTER TABLE public.permission_catalog ADD CONSTRAINT permission_catalog_action_check
    CHECK ((action = ANY (ARRAY['create'::text, 'read'::text, 'update'::text, 'delete'::text, 'safeguarding'::text, 'read-all'::text, 'sensitive'::text, 'export'::text, 'erase'::text])));

INSERT INTO public.permission_catalog (id, resource, action, key, description, created_at)
VALUES
  (gen_random_uuid(), 'student', 'read-all', 'student:read-all',
   'View every student in the school (with View students)', now()),
  (gen_random_uuid(), 'student', 'sensitive', 'student:sensitive',
   'See guardian contact details and accommodation reasons (with View students)', now()),
  (gen_random_uuid(), 'student', 'export', 'student:export',
   'Export everything held about a student (subject access request)', now()),
  (gen_random_uuid(), 'student', 'erase', 'student:erase',
   'Erase a student record', now())
ON CONFLICT (resource, action) DO UPDATE
  SET key = EXCLUDED.key, description = EXCLUDED.description;

DO $$
DECLARE
  n_read integer;
  n_safeguarding integer;
BEGIN
  SELECT count(DISTINCT srp.school_role_id) INTO n_read
  FROM public.school_role_permission srp
  JOIN public.permission_catalog pc ON pc.id = srp.permission_id
  JOIN public.school_role sr ON sr.id = srp.school_role_id
  WHERE pc.key = 'student:read' AND NOT sr.is_system;
  SELECT count(DISTINCT srp.school_role_id) INTO n_safeguarding
  FROM public.school_role_permission srp
  JOIN public.permission_catalog pc ON pc.id = srp.permission_id
  JOIN public.school_role sr ON sr.id = srp.school_role_id
  WHERE pc.key = 'pastoral-note:safeguarding' AND NOT sr.is_system;
  RAISE NOTICE 'access_defaults: % custom role(s) hold student:read (now course-scoped without student:read-all); % custom role(s) hold pastoral-note:safeguarding (unchanged). School admins no longer hold safeguarding by default.', n_read, n_safeguarding;
END $$;

-- 2. Encrypted text: pastoral_note.body and the accommodation reasons are
--    stored encrypted by the API (src/account/sensitive-text.ts), so the
--    length CHECKs now bound the ciphertext. The plain-text limits (20000
--    and 500 characters) are enforced by the API's DTOs; at up to 4 bytes a
--    character, base64 and the envelope, the ciphertext stays under these.
--    Existing rows are encrypted after deploy by the API at boot
--    (SensitiveTextBackfillService) or `bun run secrets:reencrypt`.
ALTER TABLE student.pastoral_note DROP CONSTRAINT pastoral_note_body_check;
ALTER TABLE student.pastoral_note ADD CONSTRAINT pastoral_note_body_check
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 120000);
ALTER TABLE grading.activity_accommodation DROP CONSTRAINT activity_accommodation_reason_length_check;
ALTER TABLE grading.activity_accommodation ADD CONSTRAINT activity_accommodation_reason_length_check
    CHECK (reason IS NULL OR char_length(reason) <= 4000);
ALTER TABLE grading.student_accommodation DROP CONSTRAINT student_accommodation_reason_length_check;
ALTER TABLE grading.student_accommodation ADD CONSTRAINT student_accommodation_reason_length_check
    CHECK (reason IS NULL OR char_length(reason) <= 4000);

-- 3. Audit logs are append-only. public.audit_log, public.sso_audit_log and
--    public.integration_audit_log refuse UPDATE, DELETE and TRUNCATE, with
--    two exceptions:
--    * a reserved purge path: a transaction that runs
--        SET LOCAL gradebook.audit_purge = 'on';
--      Nothing in the application sets it today: audit-log retention and
--      purging are not implemented and need an explicit decision by the
--      owner (see src/audit-log/README.md). It exists so that decision does
--      not need another trigger change;
--    * the school's own deletion: the foreign keys set audit_log.school_id
--      to NULL and delete the school's SSO and integration audit rows. A
--      row may change only that way, and only once its school is gone.
--    This stops the application (a bug, or someone driving it) from
--    rewriting history. It does not stop a database owner, who can drop
--    the trigger; see src/audit-log/README.md.
CREATE OR REPLACE FUNCTION public.audit_log_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF current_setting('gradebook.audit_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- The school was deleted: its foreign key action is clearing or removing
  -- the rows that pointed at it.
  IF OLD.school_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.school s WHERE s.id = OLD.school_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW.school_id IS NULL
       AND (to_jsonb(NEW) - 'school_id') = (to_jsonb(OLD) - 'school_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit log rows cannot be changed or deleted (%.%)', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Audit entries are append-only. A purge must run in a transaction with SET LOCAL gradebook.audit_purge = ''on''.';
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_log_no_truncate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF current_setting('gradebook.audit_purge', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'audit log tables cannot be truncated (%.%)', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON public.audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_no_truncate();

CREATE TRIGGER sso_audit_log_append_only
    BEFORE UPDATE OR DELETE ON public.sso_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();
CREATE TRIGGER sso_audit_log_no_truncate
    BEFORE TRUNCATE ON public.sso_audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_no_truncate();

CREATE TRIGGER integration_audit_log_append_only
    BEFORE UPDATE OR DELETE ON public.integration_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();
CREATE TRIGGER integration_audit_log_no_truncate
    BEFORE TRUNCATE ON public.integration_audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_no_truncate();
