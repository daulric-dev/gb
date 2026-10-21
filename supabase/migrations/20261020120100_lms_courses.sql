-- Courses: the unit a teacher creates and a student takes.
--
-- Until now work was aimed at a class (student_group) for a subject in a
-- term, and the gradebook was a set of assessments per (subject, term) feeding
-- term and year report cards. The platform is becoming a course-based LMS in
-- the Canvas/Moodle mould: a teacher creates a course, enrols students, and
-- builds it out of modules, pages, assignments and quizzes, with a gradebook
-- of its own.
--
-- This migration only adds. The class/subject tables stay where they are,
-- unused by the API, until a later cleanup migration drops them; the backfill
-- in the next migration copies their data across.
--
-- Every course table has RLS on and no policies, like grading.activity: the
-- API talks to them through the service role and enforces course roles
-- itself.

CREATE SCHEMA IF NOT EXISTS "course";
ALTER SCHEMA "course" OWNER TO "postgres";

-- Only the service role reaches these tables; no client role gets usage, so
-- an anon or user key cannot even name them.
GRANT USAGE ON SCHEMA "course" TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "course"
  GRANT ALL ON TABLES TO "service_role";

CREATE TYPE "course"."course_status" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "course"."course_staff_role" AS ENUM ('teacher', 'ta');
CREATE TYPE "course"."course_student_status" AS ENUM ('active', 'dropped', 'completed');
CREATE TYPE "course"."module_item_type" AS ENUM ('page', 'activity', 'file', 'link', 'header');

-- ── course ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "course"."course" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "school_id" "uuid" NOT NULL
      REFERENCES "public"."school"("id") ON DELETE CASCADE,
    -- Both optional: a course can stand alone, belong to a year, or to one
    -- term of it. Losing the year or term detaches rather than deletes.
    "academic_year_id" "uuid"
      REFERENCES "public"."academic_year"("id") ON DELETE SET NULL,
    "term_id" "uuid"
      REFERENCES "public"."term"("id") ON DELETE SET NULL,
    "name" "text" NOT NULL,
    "code" "text",
    "description" "text",
    "status" "course"."course_status" NOT NULL DEFAULT 'draft',
    -- Students redeem this to enrol themselves. NULL means self-enrolment is
    -- off; it is not a secret beyond the class it is handed to, so it is
    -- stored as-is like Canvas join codes rather than hashed.
    "join_code" "text",
    -- NULL falls back to the school's default scale.
    "grade_scale_id" "uuid"
      REFERENCES "grading"."grade_scale"("id") ON DELETE SET NULL,
    "created_by" "uuid"
      REFERENCES "public"."user_profile"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- Where a migrated course came from. No FKs: the source tables are going
    -- away, and these only exist to make the backfill idempotent and
    -- traceable.
    "legacy_student_group_id" "uuid",
    "legacy_subject_id" "uuid",
    CONSTRAINT "course_name_not_blank" CHECK (btrim("name") <> '')
);

ALTER TABLE "course"."course" OWNER TO "postgres";

CREATE UNIQUE INDEX IF NOT EXISTS "course_join_code_key"
  ON "course"."course" (upper("join_code")) WHERE "join_code" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "course_legacy_pair_key"
  ON "course"."course" ("legacy_student_group_id", "legacy_subject_id")
  WHERE "legacy_student_group_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "course_school_id_idx" ON "course"."course" ("school_id");
CREATE INDEX IF NOT EXISTS "course_academic_year_id_idx" ON "course"."course" ("academic_year_id");
CREATE INDEX IF NOT EXISTS "course_term_id_idx" ON "course"."course" ("term_id");
CREATE INDEX IF NOT EXISTS "course_grade_scale_id_idx" ON "course"."course" ("grade_scale_id");
CREATE INDEX IF NOT EXISTS "course_created_by_idx" ON "course"."course" ("created_by");

ALTER TABLE "course"."course" ENABLE ROW LEVEL SECURITY;

-- ── people ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "course"."course_staff" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "course_id" "uuid" NOT NULL
      REFERENCES "course"."course"("id") ON DELETE CASCADE,
    "user_profile_id" "uuid" NOT NULL
      REFERENCES "public"."user_profile"("id") ON DELETE CASCADE,
    "role" "course"."course_staff_role" NOT NULL DEFAULT 'teacher',
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_staff_course_user_key" UNIQUE ("course_id", "user_profile_id")
);

ALTER TABLE "course"."course_staff" OWNER TO "postgres";
CREATE INDEX IF NOT EXISTS "course_staff_user_profile_id_idx"
  ON "course"."course_staff" ("user_profile_id");
ALTER TABLE "course"."course_staff" ENABLE ROW LEVEL SECURITY;

-- Students are student records, not logins: a school keeps a roster of
-- students who may not have claimed an account yet, and a teacher still
-- enrols and marks them.
CREATE TABLE IF NOT EXISTS "course"."course_student" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "course_id" "uuid" NOT NULL
      REFERENCES "course"."course"("id") ON DELETE CASCADE,
    "student_id" "uuid" NOT NULL
      REFERENCES "student"."student"("id") ON DELETE CASCADE,
    "status" "course"."course_student_status" NOT NULL DEFAULT 'active',
    "enrolled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_student_course_student_key" UNIQUE ("course_id", "student_id")
);

ALTER TABLE "course"."course_student" OWNER TO "postgres";
CREATE INDEX IF NOT EXISTS "course_student_student_id_idx"
  ON "course"."course_student" ("student_id");
ALTER TABLE "course"."course_student" ENABLE ROW LEVEL SECURITY;

-- ── assignment groups ───────────────────────────────────────────────────────

-- Weighted categories (Assignments 30%, Quizzes 20%, Exam 50%). Weights need
-- not total 100: the course total renormalises over the groups that have
-- marks, as the term calculation always has.
CREATE TABLE IF NOT EXISTS "course"."assignment_group" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "course_id" "uuid" NOT NULL
      REFERENCES "course"."course"("id") ON DELETE CASCADE,
    "name" "text" NOT NULL,
    "weight" numeric(5,2),
    "position" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "assignment_group_weight_range"
      CHECK ("weight" IS NULL OR ("weight" >= 0 AND "weight" <= 100)),
    CONSTRAINT "assignment_group_name_not_blank" CHECK (btrim("name") <> '')
);

ALTER TABLE "course"."assignment_group" OWNER TO "postgres";
CREATE UNIQUE INDEX IF NOT EXISTS "assignment_group_course_name_key"
  ON "course"."assignment_group" ("course_id", lower("name"));
ALTER TABLE "course"."assignment_group" ENABLE ROW LEVEL SECURITY;

-- ── pages ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "course"."page" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "course_id" "uuid" NOT NULL
      REFERENCES "course"."course"("id") ON DELETE CASCADE,
    "title" "text" NOT NULL,
    -- Markdown. Rendered without raw HTML, so it cannot carry script.
    "body" "text" NOT NULL DEFAULT '',
    "is_published" boolean NOT NULL DEFAULT false,
    "created_by" "uuid"
      REFERENCES "public"."user_profile"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "page_title_not_blank" CHECK (btrim("title") <> '')
);

ALTER TABLE "course"."page" OWNER TO "postgres";
CREATE INDEX IF NOT EXISTS "page_course_id_idx" ON "course"."page" ("course_id");
CREATE INDEX IF NOT EXISTS "page_created_by_idx" ON "course"."page" ("created_by");
ALTER TABLE "course"."page" ENABLE ROW LEVEL SECURITY;

-- ── modules ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "course"."module" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "course_id" "uuid" NOT NULL
      REFERENCES "course"."course"("id") ON DELETE CASCADE,
    "title" "text" NOT NULL,
    "position" integer NOT NULL DEFAULT 0,
    "is_published" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "module_title_not_blank" CHECK (btrim("title") <> '')
);

ALTER TABLE "course"."module" OWNER TO "postgres";
CREATE INDEX IF NOT EXISTS "module_course_id_idx" ON "course"."module" ("course_id");
ALTER TABLE "course"."module" ENABLE ROW LEVEL SECURITY;

-- One row per entry in a module. The item points at exactly the thing its
-- type names; deleting that thing takes the item with it, so a module never
-- lists something that is gone.
CREATE TABLE IF NOT EXISTS "course"."module_item" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "module_id" "uuid" NOT NULL
      REFERENCES "course"."module"("id") ON DELETE CASCADE,
    "course_id" "uuid" NOT NULL
      REFERENCES "course"."course"("id") ON DELETE CASCADE,
    "position" integer NOT NULL DEFAULT 0,
    "item_type" "course"."module_item_type" NOT NULL,
    "title" "text",
    "page_id" "uuid"
      REFERENCES "course"."page"("id") ON DELETE CASCADE,
    "activity_id" "uuid"
      REFERENCES "grading"."activity"("id") ON DELETE CASCADE,
    "file_id" "uuid"
      REFERENCES "file_manager"."file"("id") ON DELETE CASCADE,
    "url" "text",
    "indent" smallint NOT NULL DEFAULT 0,
    "is_published" boolean NOT NULL DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "module_item_indent_range" CHECK ("indent" BETWEEN 0 AND 3),
    CONSTRAINT "module_item_target_matches_type" CHECK (
      CASE "item_type"
        WHEN 'page' THEN "page_id" IS NOT NULL
        WHEN 'activity' THEN "activity_id" IS NOT NULL
        WHEN 'file' THEN "file_id" IS NOT NULL
        WHEN 'link' THEN "url" IS NOT NULL AND "title" IS NOT NULL
        WHEN 'header' THEN "title" IS NOT NULL
      END
    )
);

ALTER TABLE "course"."module_item" OWNER TO "postgres";
CREATE INDEX IF NOT EXISTS "module_item_module_id_idx" ON "course"."module_item" ("module_id");
CREATE INDEX IF NOT EXISTS "module_item_course_id_idx" ON "course"."module_item" ("course_id");
CREATE INDEX IF NOT EXISTS "module_item_page_id_idx" ON "course"."module_item" ("page_id");
CREATE INDEX IF NOT EXISTS "module_item_activity_id_idx" ON "course"."module_item" ("activity_id");
CREATE INDEX IF NOT EXISTS "module_item_file_id_idx" ON "course"."module_item" ("file_id");
ALTER TABLE "course"."module_item" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES IN SCHEMA "course" TO "service_role";

-- ── activities move onto courses ────────────────────────────────────────────

ALTER TABLE "grading"."activity"
  ADD COLUMN IF NOT EXISTS "course_id" "uuid"
    REFERENCES "course"."course"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "assignment_group_id" "uuid"
    REFERENCES "course"."assignment_group"("id") ON DELETE SET NULL,
  -- Kept and marked, but left out of the course total. Replaces exclusion on
  -- the assessment, which no longer exists for new work.
  ADD COLUMN IF NOT EXISTS "omit_from_final_grade" boolean NOT NULL DEFAULT false;

-- The class/subject/term triple is now legacy: new work has a course and
-- none of these.
ALTER TABLE "grading"."activity" ALTER COLUMN "student_group_id" DROP NOT NULL;
ALTER TABLE "grading"."activity" ALTER COLUMN "subject_id" DROP NOT NULL;
ALTER TABLE "grading"."activity" ALTER COLUMN "term_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "activity_course_id_idx" ON "grading"."activity" ("course_id");
CREATE INDEX IF NOT EXISTS "activity_assignment_group_id_idx"
  ON "grading"."activity" ("assignment_group_id");

-- ── the submission is the mark ──────────────────────────────────────────────

-- A mark used to live twice: on the submission and in grading.grade against
-- the activity's assessment. The course gradebook reads the submission only,
-- so excusing a student moves here too.
ALTER TABLE "grading"."submission"
  ADD COLUMN IF NOT EXISTS "excused" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "excused_reason" "text";

-- Same scoring as before, except that it stops writing to grading.grade and
-- only counts an option chosen from the question it answers.
CREATE OR REPLACE FUNCTION "grading"."submit_quiz"(
  "p_submission_id" "uuid",
  "p_student_id" "uuid"
)
RETURNS TABLE ("score" numeric, "points" numeric, "attempts_used" integer)
LANGUAGE "plpgsql"
VOLATILE
SECURITY DEFINER
SET search_path = "grading", "public"
AS $$
DECLARE
  v_sub      record;
  v_activity record;
  v_earned   numeric := 0;
  v_possible numeric := 0;
  v_scaled   numeric;
  v_attempts integer;
BEGIN
  SELECT s.id, s.activity_id, s.student_id, s.status, s.attempt_count
  INTO v_sub
  FROM grading.submission s WHERE s.id = p_submission_id FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'submission_not_found' USING ERRCODE = 'P0020';
  END IF;

  -- The caller passes the student the guard resolved, never one from a client.
  IF v_sub.student_id <> p_student_id THEN
    RAISE EXCEPTION 'submission_not_yours' USING ERRCODE = 'P0021';
  END IF;

  SELECT a.id, a.kind, a.points, a.status, a.max_attempts
  INTO v_activity
  FROM grading.activity a WHERE a.id = v_sub.activity_id;

  IF v_activity.kind <> 'quiz' THEN
    RAISE EXCEPTION 'not_a_quiz' USING ERRCODE = 'P0023';
  END IF;

  IF v_activity.status <> 'published' THEN
    RAISE EXCEPTION 'activity_not_open' USING ERRCODE = 'P0024';
  END IF;

  -- NULL max_attempts is unlimited; otherwise this attempt must fit.
  IF v_activity.max_attempts IS NOT NULL
     AND v_sub.attempt_count >= v_activity.max_attempts THEN
    RAISE EXCEPTION 'no_attempts_left' USING ERRCODE = 'P0022';
  END IF;

  v_attempts := v_sub.attempt_count + 1;

  SELECT
    COALESCE(SUM(q.points), 0),
    COALESCE(SUM(CASE WHEN correct.hit THEN q.points ELSE 0 END), 0)
  INTO v_possible, v_earned
  FROM grading.quiz_question q
  LEFT JOIN grading.quiz_answer ans
    ON ans.question_id = q.id AND ans.submission_id = p_submission_id
  LEFT JOIN LATERAL (
    SELECT CASE
      WHEN q.kind = 'short_answer' THEN EXISTS (
        SELECT 1
        FROM grading.quiz_option o
        WHERE o.question_id = q.id
          AND o.is_correct
          AND ans.text_answer IS NOT NULL
          AND lower(btrim(ans.text_answer)) = lower(btrim(o.label))
      )
      -- The option must belong to this question: a correct option id from
      -- some other question is not a right answer here.
      ELSE EXISTS (
        SELECT 1
        FROM grading.quiz_option o
        WHERE o.id = ans.option_id AND o.question_id = q.id AND o.is_correct
      )
    END AS hit
  ) correct ON true
  WHERE q.activity_id = v_activity.id;

  -- Scale to the activity's points so the gradebook is in its own units.
  v_scaled := CASE
    WHEN v_possible > 0 THEN (v_earned / v_possible) * v_activity.points
    ELSE 0
  END;

  UPDATE grading.submission s
  SET status = 'graded',
      submitted_at = now(),
      graded_at = now(),
      score = v_scaled,
      attempt_count = v_attempts,
      updated_at = now()
  WHERE s.id = p_submission_id;

  RETURN QUERY SELECT v_scaled, v_activity.points, v_attempts;
END;
$$;

REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") TO "service_role";

-- ── course announcements ────────────────────────────────────────────────────

-- NULL stays school-wide, which is every announcement that exists today.
ALTER TABLE "public"."announcement"
  ADD COLUMN IF NOT EXISTS "course_id" "uuid"
    REFERENCES "course"."course"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "announcement_course_id_idx"
  ON "public"."announcement" ("course_id");

-- ── free-text term names ────────────────────────────────────────────────────

-- Michaelmas/Hilary/Trinity fit one school calendar. Courses run on whatever
-- terms a school has - "Semester 1", "Fall 2026", "Summer intensive".
ALTER TABLE "public"."term"
  ALTER COLUMN "name" TYPE "text" USING "name"::"text";
ALTER TABLE "public"."term"
  ADD CONSTRAINT "term_name_not_blank" CHECK ("name" IS NULL OR btrim("name") <> '');
