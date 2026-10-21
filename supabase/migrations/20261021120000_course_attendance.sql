-- Course attendance with student self check-in, plus push notification devices.
--
-- A teacher opens an attendance session for a course. Every enrolled student
-- with an account gets a push notification and a banner in the portal, and
-- checks themselves in while the session is open - with the code shown in
-- the room, and from close enough to the room when the teacher asked for a
-- location check. Whoever has not checked in when it closes is marked absent.
-- The teacher can override any student's status at any time.
--
-- The old class attendance (student.attendance_record) stays untouched until
-- the LMS cleanup migration; nothing reads it any more.
--
-- Like the rest of the course schema: RLS on, no policies, service role only.

CREATE TYPE "course"."attendance_status" AS ENUM ('present', 'late', 'absent', 'excused');
CREATE TYPE "course"."attendance_method" AS ENUM ('self', 'teacher', 'auto');

CREATE TABLE IF NOT EXISTS "course"."attendance_session" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "course_id" "uuid" NOT NULL
      REFERENCES "course"."course"("id") ON DELETE CASCADE,
    "title" "text",
    "opened_by" "uuid"
      REFERENCES "public"."user_profile"("id") ON DELETE SET NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    -- When self check-in stops. Closing early sets closed_at sooner.
    "closes_at" timestamp with time zone NOT NULL,
    -- Set once the session is finalised (absentees recorded). NULL while open,
    -- and briefly after closes_at until the next sweep or read finalises it.
    "closed_at" timestamp with time zone,
    -- Shown in the room; a student must type it. NULL when not required.
    "check_in_code" "text",
    -- Check-ins this many minutes after opening count as late. NULL: never.
    "late_after_minutes" integer,
    -- Optional location check: the teacher's position at opening, and how far
    -- from it a student may check in.
    "latitude" double precision,
    "longitude" double precision,
    "radius_m" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attendance_session_window" CHECK ("closes_at" > "opened_at"),
    CONSTRAINT "attendance_session_late_positive"
      CHECK ("late_after_minutes" IS NULL OR "late_after_minutes" >= 0),
    CONSTRAINT "attendance_session_location_complete" CHECK (
      ("latitude" IS NULL AND "longitude" IS NULL AND "radius_m" IS NULL)
      OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL
          AND "radius_m" BETWEEN 10 AND 5000)
    ),
    CONSTRAINT "attendance_session_code_format"
      CHECK ("check_in_code" IS NULL OR "check_in_code" ~ '^[0-9]{4}$')
);

ALTER TABLE "course"."attendance_session" OWNER TO "postgres";

-- One open session per course at a time; a second "take attendance" while
-- one is running is almost always a double click.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_session_one_open_per_course"
  ON "course"."attendance_session" ("course_id") WHERE "closed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "attendance_session_course_id_idx"
  ON "course"."attendance_session" ("course_id", "opened_at" DESC);
CREATE INDEX IF NOT EXISTS "attendance_session_opened_by_idx"
  ON "course"."attendance_session" ("opened_by");
-- The sweep that finalises expired sessions looks for exactly these.
CREATE INDEX IF NOT EXISTS "attendance_session_open_idx"
  ON "course"."attendance_session" ("closes_at") WHERE "closed_at" IS NULL;

ALTER TABLE "course"."attendance_session" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "course"."attendance_record" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "session_id" "uuid" NOT NULL
      REFERENCES "course"."attendance_session"("id") ON DELETE CASCADE,
    "course_id" "uuid" NOT NULL
      REFERENCES "course"."course"("id") ON DELETE CASCADE,
    "student_id" "uuid" NOT NULL
      REFERENCES "student"."student"("id") ON DELETE CASCADE,
    "status" "course"."attendance_status" NOT NULL,
    "method" "course"."attendance_method" NOT NULL,
    "checked_in_at" timestamp with time zone,
    -- How far from the session's location the check-in came from, kept so a
    -- teacher can see why a borderline one was accepted.
    "distance_m" integer,
    "note" "text",
    "updated_by" "uuid"
      REFERENCES "public"."user_profile"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attendance_record_session_student_key" UNIQUE ("session_id", "student_id")
);

ALTER TABLE "course"."attendance_record" OWNER TO "postgres";
CREATE INDEX IF NOT EXISTS "attendance_record_course_student_idx"
  ON "course"."attendance_record" ("course_id", "student_id");
CREATE INDEX IF NOT EXISTS "attendance_record_student_id_idx"
  ON "course"."attendance_record" ("student_id");
CREATE INDEX IF NOT EXISTS "attendance_record_updated_by_idx"
  ON "course"."attendance_record" ("updated_by");

ALTER TABLE "course"."attendance_record" ENABLE ROW LEVEL SECURITY;

-- ── push devices ────────────────────────────────────────────────────────────

-- Expo push tokens, one row per installed app. A token moves to whoever last
-- signed in on that device, so a shared phone does not notify its previous
-- owner.
CREATE TABLE IF NOT EXISTS "public"."push_device" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "user_id" "uuid" NOT NULL
      REFERENCES "public"."user_profile"("id") ON DELETE CASCADE,
    "token" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_device_token_key" UNIQUE ("token"),
    CONSTRAINT "push_device_platform_check" CHECK ("platform" IN ('ios', 'android', 'web'))
);

ALTER TABLE "public"."push_device" OWNER TO "postgres";
CREATE INDEX IF NOT EXISTS "push_device_user_id_idx" ON "public"."push_device" ("user_id");
ALTER TABLE "public"."push_device" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."push_device" FROM "anon", "authenticated";

GRANT ALL ON ALL TABLES IN SCHEMA "course" TO "service_role";
GRANT ALL ON TABLE "public"."push_device" TO "service_role";
