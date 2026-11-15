/**
 * PostgreSQL defence-in-depth objects that Prisma cannot declare: trigger
 * functions, triggers and expression indexes. Each one backs a guarantee
 * the application already enforces on every provider (see
 * prisma/DATABASE_PORTABILITY.md, "Setup-layer inventory"). Bodies are
 * byte-for-byte the ones the old migrations created, so a database built by
 * those migrations is left untouched.
 */

export interface FunctionSpec {
  schema: string;
  name: string;
  /** `SET search_path ...` and similar options, or ''. */
  options: string;
  /** The plpgsql body, as stored in pg_proc.prosrc. */
  body: string;
}

export interface TriggerSpec {
  table: string;
  name: string;
  /** Full CREATE TRIGGER statement, as pg_get_triggerdef prints it. */
  definition: string;
}

export interface IndexSpec {
  /** Schema of the index (the table's schema). */
  schema: string;
  name: string;
  definition: string;
  why: string;
}

const AUDIT_APPEND_ONLY = `
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
`;

const AUDIT_NO_TRUNCATE = `
BEGIN
  IF current_setting('gradebook.audit_purge', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'audit log tables cannot be truncated (%.%)', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
`;

const SET_STUDENT_LEFT_AT = `
BEGIN
  IF NEW.is_active IS DISTINCT FROM false THEN
    NEW.left_at := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM false THEN
    NEW.left_at := COALESCE(NEW.left_at, now());
  ELSE
    -- Still inactive: keep the original date.
    NEW.left_at := COALESCE(OLD.left_at, NEW.left_at, now());
  END IF;
  RETURN NEW;
END;
`;

const PEER_REVIEW_NOT_SELF = `
BEGIN
  IF EXISTS (
    SELECT 1 FROM grading.submission s
    WHERE s.id = NEW.submission_id AND s.student_id = NEW.reviewer_id
  ) THEN
    RAISE EXCEPTION 'A student cannot review their own submission' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
`;

const AUDIT_SEARCH_PATH = "SET search_path TO 'pg_catalog', 'public'";

export const POSTGRES_FUNCTIONS: readonly FunctionSpec[] = [
  { schema: 'public', name: 'audit_log_append_only', options: AUDIT_SEARCH_PATH, body: AUDIT_APPEND_ONLY },
  { schema: 'public', name: 'audit_log_no_truncate', options: AUDIT_SEARCH_PATH, body: AUDIT_NO_TRUNCATE },
  { schema: 'student', name: 'set_student_left_at', options: '', body: SET_STUDENT_LEFT_AT },
  { schema: 'grading', name: 'peer_review_allocation_not_self', options: '', body: PEER_REVIEW_NOT_SELF },
];

const auditTriggers = (table: string): TriggerSpec[] => [
  {
    table: `public.${table}`,
    name: `${table}_append_only`,
    definition: `CREATE TRIGGER ${table}_append_only BEFORE DELETE OR UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION audit_log_append_only()`,
  },
  {
    table: `public.${table}`,
    name: `${table}_no_truncate`,
    definition: `CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON public.${table} FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate()`,
  },
];

export const POSTGRES_TRIGGERS: readonly TriggerSpec[] = [
  ...auditTriggers('audit_log'),
  ...auditTriggers('sso_audit_log'),
  ...auditTriggers('integration_audit_log'),
  {
    table: 'student.student',
    name: 'student_set_left_at',
    definition:
      'CREATE TRIGGER student_set_left_at BEFORE INSERT OR UPDATE OF is_active, left_at ON student.student FOR EACH ROW EXECUTE FUNCTION student.set_student_left_at()',
  },
  {
    table: 'grading.peer_review_allocation',
    name: 'peer_review_allocation_not_self',
    definition:
      'CREATE TRIGGER peer_review_allocation_not_self BEFORE INSERT OR UPDATE OF reviewer_id, submission_id ON grading.peer_review_allocation FOR EACH ROW EXECUTE FUNCTION grading.peer_review_allocation_not_self()',
  },
];

/**
 * Expression indexes. `prisma db push` ignores indexes on expressions (it
 * neither creates nor drops them), so they live here. Partial indexes on
 * plain columns are declared in the Prisma schema instead (`where:`, the
 * `partialIndexes` preview feature), where db push owns them; listing them
 * here as well would make the two fight.
 */
export const POSTGRES_EXPRESSION_INDEXES: readonly IndexSpec[] = [
  {
    schema: 'public',
    name: 'organisation_singleton',
    definition: 'CREATE UNIQUE INDEX organisation_singleton ON public.organisation USING btree ((true))',
    why: 'At most one organisation row.'
  },
  {
    schema: 'compliance',
    name: 'data_export_one_active_key',
    definition:
      "CREATE UNIQUE INDEX data_export_one_active_key ON compliance.data_export USING btree (requested_by, kind, COALESCE(student_id, subject_user_id)) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]))",
    why: 'One pending/running export per requester, kind and subject.',
  },
  {
    schema: 'course',
    name: 'assignment_group_course_name_key',
    definition: 'CREATE UNIQUE INDEX assignment_group_course_name_key ON course.assignment_group USING btree (course_id, lower(name))',
    why: 'Assignment group names are unique per course, ignoring case.',
  },
  {
    schema: 'course',
    name: 'course_join_code_key',
    definition: 'CREATE UNIQUE INDEX course_join_code_key ON course.course USING btree (upper(join_code)) WHERE (join_code IS NOT NULL)',
    why: 'Course join codes are unique across the install, ignoring case.',
  },
  {
    schema: 'public',
    name: 'school_webhook_header_name_key',
    definition: 'CREATE UNIQUE INDEX school_webhook_header_name_key ON public.school_webhook_header USING btree (webhook_id, lower(name))',
    why: 'Custom header names are unique per webhook, ignoring case.',
  },
];

/** Extension the schema's trigram GIN indexes need before `db push`. */
export const TRIGRAM_EXTENSION = 'pg_trgm';
