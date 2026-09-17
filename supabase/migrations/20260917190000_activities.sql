-- Quizzes and assignments: work a teacher posts to a class and a student does.
--
-- Two things make these different from the assessments that already exist.
-- An assessment is scoped to (subject, term) and applies to everyone taking
-- that subject; something a student actually completes has to be aimed at a
-- class, so activity carries student_group_id. And a student never sees an
-- assessment, whereas the whole point here is that they do.
--
-- Grades still land in grading.grade against an assessment, so reports,
-- averages and the weighted groups keep working untouched: publishing an
-- activity creates the assessment row it feeds.

CREATE TYPE "grading"."activity_kind" AS ENUM ('quiz', 'assignment');
CREATE TYPE "grading"."activity_status" AS ENUM ('draft', 'published', 'closed');
CREATE TYPE "grading"."question_kind" AS ENUM ('multiple_choice', 'true_false');
CREATE TYPE "grading"."submission_status" AS ENUM ('draft', 'submitted', 'graded');

CREATE TABLE IF NOT EXISTS "grading"."activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    -- The class it is set for. Without this every student taking the subject
    -- would see it, which is not what "assign to a class" means.
    "student_group_id" "uuid" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "term_id" "uuid" NOT NULL,
    "grading_group_id" "uuid",
    -- The gradebook row this feeds; created when the activity is published.
    "assessment_id" "uuid",
    "kind" "grading"."activity_kind" NOT NULL,
    "title" "text" NOT NULL,
    "instructions" "text",
    "points" numeric NOT NULL DEFAULT 100,
    "due_at" timestamp with time zone,
    "status" "grading"."activity_status" NOT NULL DEFAULT 'draft',
    "published_at" timestamp with time zone,
    -- Assignments only; a quiz is answered in place.
    "allow_file" boolean NOT NULL DEFAULT false,
    "allow_text" boolean NOT NULL DEFAULT false,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text") NOT NULL,
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text") NOT NULL
);

ALTER TABLE "grading"."activity" OWNER TO "postgres";
ALTER TABLE "grading"."activity" ADD CONSTRAINT "activity_pkey" PRIMARY KEY ("id");

ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_student_group_id_fkey" FOREIGN KEY ("student_group_id")
  REFERENCES "public"."student_group"("id") ON DELETE CASCADE;
ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_subject_id_fkey" FOREIGN KEY ("subject_id")
  REFERENCES "public"."subject"("id") ON DELETE CASCADE;
ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_term_id_fkey" FOREIGN KEY ("term_id")
  REFERENCES "public"."term"("id") ON DELETE CASCADE;
ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_grading_group_id_fkey" FOREIGN KEY ("grading_group_id")
  REFERENCES "grading"."grading_group"("id") ON DELETE SET NULL;
ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_assessment_id_fkey" FOREIGN KEY ("assessment_id")
  REFERENCES "grading"."assessment"("id") ON DELETE SET NULL;
ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_created_by_fkey" FOREIGN KEY ("created_by")
  REFERENCES "public"."user_profile"("id") ON DELETE RESTRICT;

ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_points_positive" CHECK ("points" > 0);

-- An assignment nobody can submit to is a mistake worth catching early.
ALTER TABLE "grading"."activity"
  ADD CONSTRAINT "activity_assignment_accepts_something"
  CHECK ("kind" <> 'assignment' OR "allow_file" OR "allow_text");

CREATE INDEX IF NOT EXISTS "idx_activity_class" ON "grading"."activity"("student_group_id");
CREATE INDEX IF NOT EXISTS "idx_activity_term_subject" ON "grading"."activity"("term_id", "subject_id");
CREATE INDEX IF NOT EXISTS "idx_activity_status" ON "grading"."activity"("status");

ALTER TABLE "grading"."activity" ENABLE ROW LEVEL SECURITY;

-- ── quiz content ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "grading"."quiz_question" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "prompt" "text" NOT NULL,
    "kind" "grading"."question_kind" NOT NULL,
    "points" numeric NOT NULL DEFAULT 1,
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text") NOT NULL
);

ALTER TABLE "grading"."quiz_question" OWNER TO "postgres";
ALTER TABLE "grading"."quiz_question" ADD CONSTRAINT "quiz_question_pkey" PRIMARY KEY ("id");
ALTER TABLE "grading"."quiz_question"
  ADD CONSTRAINT "quiz_question_activity_id_fkey" FOREIGN KEY ("activity_id")
  REFERENCES "grading"."activity"("id") ON DELETE CASCADE;
ALTER TABLE "grading"."quiz_question"
  ADD CONSTRAINT "quiz_question_points_positive" CHECK ("points" > 0);
CREATE INDEX IF NOT EXISTS "idx_quiz_question_activity" ON "grading"."quiz_question"("activity_id");
ALTER TABLE "grading"."quiz_question" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "grading"."quiz_option" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "is_correct" boolean NOT NULL DEFAULT false,
    "sort_order" integer NOT NULL DEFAULT 0
);

ALTER TABLE "grading"."quiz_option" OWNER TO "postgres";
ALTER TABLE "grading"."quiz_option" ADD CONSTRAINT "quiz_option_pkey" PRIMARY KEY ("id");
ALTER TABLE "grading"."quiz_option"
  ADD CONSTRAINT "quiz_option_question_id_fkey" FOREIGN KEY ("question_id")
  REFERENCES "grading"."quiz_question"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_quiz_option_question" ON "grading"."quiz_option"("question_id");
ALTER TABLE "grading"."quiz_option" ENABLE ROW LEVEL SECURITY;

-- ── submissions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "grading"."submission" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "status" "grading"."submission_status" NOT NULL DEFAULT 'draft',
    "text_body" "text",
    "file_id" "uuid",
    "submitted_at" timestamp with time zone,
    "score" numeric,
    "feedback" "text",
    "graded_at" timestamp with time zone,
    "graded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text") NOT NULL,
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text") NOT NULL
);

ALTER TABLE "grading"."submission" OWNER TO "postgres";
ALTER TABLE "grading"."submission" ADD CONSTRAINT "submission_pkey" PRIMARY KEY ("id");
ALTER TABLE "grading"."submission"
  ADD CONSTRAINT "submission_activity_id_fkey" FOREIGN KEY ("activity_id")
  REFERENCES "grading"."activity"("id") ON DELETE CASCADE;
ALTER TABLE "grading"."submission"
  ADD CONSTRAINT "submission_student_id_fkey" FOREIGN KEY ("student_id")
  REFERENCES "student"."student"("id") ON DELETE CASCADE;
ALTER TABLE "grading"."submission"
  ADD CONSTRAINT "submission_file_id_fkey" FOREIGN KEY ("file_id")
  REFERENCES "file_manager"."file"("id") ON DELETE SET NULL;
ALTER TABLE "grading"."submission"
  ADD CONSTRAINT "submission_graded_by_fkey" FOREIGN KEY ("graded_by")
  REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

-- One attempt per student in this cut; retakes would relax this.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_submission_one_per_student"
  ON "grading"."submission"("activity_id", "student_id");
CREATE INDEX IF NOT EXISTS "idx_submission_student" ON "grading"."submission"("student_id");
ALTER TABLE "grading"."submission" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "grading"."quiz_answer" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "question_id" "uuid" NOT NULL,
    "option_id" "uuid"
);

ALTER TABLE "grading"."quiz_answer" OWNER TO "postgres";
ALTER TABLE "grading"."quiz_answer" ADD CONSTRAINT "quiz_answer_pkey" PRIMARY KEY ("id");
ALTER TABLE "grading"."quiz_answer"
  ADD CONSTRAINT "quiz_answer_submission_id_fkey" FOREIGN KEY ("submission_id")
  REFERENCES "grading"."submission"("id") ON DELETE CASCADE;
ALTER TABLE "grading"."quiz_answer"
  ADD CONSTRAINT "quiz_answer_question_id_fkey" FOREIGN KEY ("question_id")
  REFERENCES "grading"."quiz_question"("id") ON DELETE CASCADE;
ALTER TABLE "grading"."quiz_answer"
  ADD CONSTRAINT "quiz_answer_option_id_fkey" FOREIGN KEY ("option_id")
  REFERENCES "grading"."quiz_option"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_quiz_answer_one_per_question"
  ON "grading"."quiz_answer"("submission_id", "question_id");
ALTER TABLE "grading"."quiz_answer" ENABLE ROW LEVEL SECURITY;

-- ── submit a quiz ───────────────────────────────────────────────────────────
-- Marks the attempt, scores it against the correct options, and writes the
-- gradebook row. One transaction: a scored attempt with no grade recorded, or
-- a grade with no attempt, are both worse than failing outright.
CREATE OR REPLACE FUNCTION "grading"."submit_quiz"(
  "p_submission_id" "uuid",
  "p_student_id" "uuid"
)
RETURNS TABLE ("score" numeric, "points" numeric)
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
BEGIN
  SELECT s.id, s.activity_id, s.student_id, s.status INTO v_sub
  FROM grading.submission s WHERE s.id = p_submission_id FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'submission_not_found' USING ERRCODE = 'P0020';
  END IF;

  -- The caller passes the student the guard resolved, never one from a client.
  IF v_sub.student_id <> p_student_id THEN
    RAISE EXCEPTION 'submission_not_yours' USING ERRCODE = 'P0021';
  END IF;

  IF v_sub.status <> 'draft' THEN
    RAISE EXCEPTION 'already_submitted' USING ERRCODE = 'P0022';
  END IF;

  SELECT a.id, a.kind, a.points, a.assessment_id, a.status, a.due_at
  INTO v_activity
  FROM grading.activity a WHERE a.id = v_sub.activity_id;

  IF v_activity.kind <> 'quiz' THEN
    RAISE EXCEPTION 'not_a_quiz' USING ERRCODE = 'P0023';
  END IF;

  IF v_activity.status <> 'published' THEN
    RAISE EXCEPTION 'activity_not_open' USING ERRCODE = 'P0024';
  END IF;

  SELECT
    COALESCE(SUM(q.points), 0),
    COALESCE(SUM(CASE WHEN o.is_correct THEN q.points ELSE 0 END), 0)
  INTO v_possible, v_earned
  FROM grading.quiz_question q
  LEFT JOIN grading.quiz_answer ans
    ON ans.question_id = q.id AND ans.submission_id = p_submission_id
  LEFT JOIN grading.quiz_option o ON o.id = ans.option_id
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
      updated_at = now()
  WHERE s.id = p_submission_id;

  -- Feed the gradebook so averages, weights and reports pick it up.
  IF v_activity.assessment_id IS NOT NULL THEN
    INSERT INTO grading.grade (assessment_id, student_id, score)
    VALUES (v_activity.assessment_id, p_student_id, v_scaled)
    ON CONFLICT (assessment_id, student_id)
    DO UPDATE SET score = EXCLUDED.score, updated_at = now();
  END IF;

  RETURN QUERY SELECT v_scaled, v_activity.points;
END;
$$;

REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "grading"."submit_quiz"("uuid", "uuid") TO "service_role";
