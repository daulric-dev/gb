-- Attendance tracking: one record per student per class (student_group) per day.
-- Status is present/absent/late. School scoping is reached through
-- student_group_id -> academic_year.school_id, matching the existing
-- student_group_enrollment RLS pattern.

CREATE TYPE "public"."attendance_status" AS ENUM (
    'present',
    'absent',
    'late'
);

ALTER TYPE "public"."attendance_status" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "student"."attendance_record" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "student_group_id" "uuid" NOT NULL,
    "attendance_date" "date" NOT NULL,
    "status" "public"."attendance_status" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);

ALTER TABLE "student"."attendance_record" OWNER TO "postgres";

ALTER TABLE ONLY "student"."attendance_record"
    ADD CONSTRAINT "attendance_record_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "student"."attendance_record"
    ADD CONSTRAINT "attendance_record_student_group_date_unique"
    UNIQUE ("student_id", "student_group_id", "attendance_date");

ALTER TABLE ONLY "student"."attendance_record"
    ADD CONSTRAINT "attendance_record_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "student"."attendance_record"
    ADD CONSTRAINT "attendance_record_student_group_id_fkey"
    FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "student"."attendance_record"
    ADD CONSTRAINT "attendance_record_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "student"."attendance_record"
    ADD CONSTRAINT "attendance_record_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

CREATE INDEX "idx_attendance_group_date" ON "student"."attendance_record"
    USING "btree" ("student_group_id", "attendance_date");

CREATE INDEX "idx_attendance_student_date" ON "student"."attendance_record"
    USING "btree" ("student_id", "attendance_date");

ALTER TABLE "student"."attendance_record" ENABLE ROW LEVEL SECURITY;

-- Read: admins see all rows whose group rolls up to their school; teachers
-- see only rows for groups they're assigned to.
CREATE POLICY "assignment_read" ON "student"."attendance_record"
  FOR SELECT
  USING (
    (
      "public"."is_admin"()
      AND EXISTS (
        SELECT 1
        FROM "public"."student_group" "sg"
        JOIN "public"."academic_year" "ay" ON ("ay"."id" = "sg"."academic_year_id")
        WHERE "sg"."id" = "attendance_record"."student_group_id"
          AND "ay"."school_id" = "public"."get_user_school_id"()
      )
    )
    OR "public"."is_assigned_to_group"("attendance_record"."student_group_id")
  );

-- Write policies mirror read: admins (within their school) or assigned
-- teachers can insert/update/delete attendance for the group.
CREATE POLICY "assignment_write_insert" ON "student"."attendance_record"
  FOR INSERT
  WITH CHECK (
    (
      "public"."is_admin"()
      AND EXISTS (
        SELECT 1
        FROM "public"."student_group" "sg"
        JOIN "public"."academic_year" "ay" ON ("ay"."id" = "sg"."academic_year_id")
        WHERE "sg"."id" = "attendance_record"."student_group_id"
          AND "ay"."school_id" = "public"."get_user_school_id"()
      )
    )
    OR "public"."is_assigned_to_group"("attendance_record"."student_group_id")
  );

CREATE POLICY "assignment_write_update" ON "student"."attendance_record"
  FOR UPDATE
  USING (
    (
      "public"."is_admin"()
      AND EXISTS (
        SELECT 1
        FROM "public"."student_group" "sg"
        JOIN "public"."academic_year" "ay" ON ("ay"."id" = "sg"."academic_year_id")
        WHERE "sg"."id" = "attendance_record"."student_group_id"
          AND "ay"."school_id" = "public"."get_user_school_id"()
      )
    )
    OR "public"."is_assigned_to_group"("attendance_record"."student_group_id")
  );

CREATE POLICY "assignment_write_delete" ON "student"."attendance_record"
  FOR DELETE
  USING (
    (
      "public"."is_admin"()
      AND EXISTS (
        SELECT 1
        FROM "public"."student_group" "sg"
        JOIN "public"."academic_year" "ay" ON ("ay"."id" = "sg"."academic_year_id")
        WHERE "sg"."id" = "attendance_record"."student_group_id"
          AND "ay"."school_id" = "public"."get_user_school_id"()
      )
    )
    OR "public"."is_assigned_to_group"("attendance_record"."student_group_id")
  );

GRANT ALL ON TYPE "public"."attendance_status" TO "anon";
GRANT ALL ON TYPE "public"."attendance_status" TO "authenticated";
GRANT ALL ON TYPE "public"."attendance_status" TO "service_role";

GRANT ALL ON TABLE "student"."attendance_record" TO "authenticated";
GRANT ALL ON TABLE "student"."attendance_record" TO "anon";
GRANT ALL ON TABLE "student"."attendance_record" TO "service_role";
