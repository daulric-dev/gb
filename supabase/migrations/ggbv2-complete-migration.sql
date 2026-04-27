


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "grading";


ALTER SCHEMA "grading" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "reporting";


ALTER SCHEMA "reporting" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "staff";


ALTER SCHEMA "staff" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "student";


ALTER SCHEMA "student" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "wrappers" WITH SCHEMA "extensions";






CREATE TYPE "public"."assessment_type" AS ENUM (
    'exam',
    'coursework'
);


ALTER TYPE "public"."assessment_type" OWNER TO "postgres";


CREATE TYPE "public"."gender" AS ENUM (
    'male',
    'female'
);


ALTER TYPE "public"."gender" OWNER TO "postgres";


CREATE TYPE "public"."gradingmodel" AS ENUM (
    'term_based',
    'year_based'
);


ALTER TYPE "public"."gradingmodel" OWNER TO "postgres";


CREATE TYPE "public"."relationship_type" AS ENUM (
    'mother',
    'father',
    'guardian'
);


ALTER TYPE "public"."relationship_type" OWNER TO "postgres";


CREATE TYPE "public"."report_book_status" AS ENUM (
    'draft',
    'published',
    'sent_to_ministry'
);


ALTER TYPE "public"."report_book_status" OWNER TO "postgres";


CREATE TYPE "public"."report_book_type" AS ENUM (
    'term',
    'year_end'
);


ALTER TYPE "public"."report_book_type" OWNER TO "postgres";


CREATE TYPE "public"."role" AS ENUM (
    'admin',
    'teacher'
);


ALTER TYPE "public"."role" OWNER TO "postgres";


CREATE TYPE "public"."schooltype" AS ENUM (
    'primary',
    'secondary'
);


ALTER TYPE "public"."schooltype" OWNER TO "postgres";


CREATE TYPE "public"."term_name" AS ENUM (
    'michaelmas',
    'hilary',
    'trinity'
);


ALTER TYPE "public"."term_name" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_school_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT school_id FROM public.user_profile
  WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_user_school_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profile
    WHERE id = auth.uid()
    AND role = 'admin'
    AND is_active = true
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_assigned_to_group"("p_group_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff.teacher_group_assignment
    WHERE user_profile_id = auth.uid()
    AND student_group_id = p_group_id
  );
$$;


ALTER FUNCTION "public"."is_assigned_to_group"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_assigned_to_subject_in_group"("p_subject_id" "uuid", "p_group_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff.teacher_subject_assignment
    WHERE user_profile_id = auth.uid()
    AND subject_id = p_subject_id
    AND student_group_id = p_group_id
  );
$$;


ALTER FUNCTION "public"."is_assigned_to_subject_in_group"("p_subject_id" "uuid", "p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "grading"."assessment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "term_id" "uuid",
    "subject_id" "uuid",
    "title" "text",
    "assessment_type" "public"."assessment_type",
    "assessment_date" "date",
    "max_score" smallint,
    "weight" numeric,
    "is_excluded" boolean DEFAULT false,
    "exclusion_reason" "text",
    "sort_order" smallint
);


ALTER TABLE "grading"."assessment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "grading"."grade" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "assessment_id" "uuid",
    "student_id" "uuid",
    "score" numeric,
    "letter_grade" "text",
    "remarks" "text",
    "is_excluded" boolean DEFAULT false,
    "exclusion_reason" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);


ALTER TABLE "grading"."grade" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."academic_year" (
    "school_id" "uuid",
    "name" "text",
    "start_date" "date",
    "end_date" "date",
    "grading_model" "public"."gradingmodel",
    "is_active" boolean DEFAULT true,
    "year_exam_weight" numeric,
    "year_coursework_weight" numeric,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."academic_year" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."school" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "code" "text",
    "school_type" "public"."schooltype",
    "address" "text",
    "parish" "text",
    "phone" "text",
    "email" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);


ALTER TABLE "public"."school" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_group" (
    "name" "text" NOT NULL,
    "academic_year_id" "uuid",
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."student_group" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subject" (
    "school_id" "uuid",
    "name" "text",
    "code" "text",
    "is_graded" boolean DEFAULT true,
    "sort_order" smallint,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."subject" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."term" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "public"."term_name",
    "academic_year_id" "uuid",
    "start_date" "date",
    "end_date" "date",
    "is_ministry_reporting" boolean DEFAULT false,
    "exam_weight" numeric,
    "coursework_weight" numeric,
    "sort_order" smallint
);


ALTER TABLE "public"."term" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profile" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "first_name" "text",
    "last_name" "text",
    "role" "public"."role",
    "avatar_url" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);


ALTER TABLE "public"."user_profile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "reporting"."class_report_file" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_group_id" "uuid" NOT NULL,
    "term_id" "uuid" NOT NULL,
    "report_type" "text" NOT NULL,
    "file_type" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "generated_by" "uuid",
    "generated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "reporting"."class_report_file" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "reporting"."report_book" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid",
    "term_id" "uuid",
    "academic_year_id" "uuid",
    "report_type" "public"."report_book_type",
    "status" "public"."report_book_status",
    "general_remarks" "text",
    "conduct_grade" "text",
    "attendance_days" smallint,
    "total_school_days" smallint,
    "created_by" "uuid",
    "generated_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "student_group_id" "uuid",
    "position" bigint,
    "overall_average" numeric,
    "total_students" bigint
);


ALTER TABLE "reporting"."report_book" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "reporting"."report_book_entry" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_book_id" "uuid",
    "subject_id" "uuid",
    "term_average" numeric,
    "letter_grade" "text",
    "teacher_remark" "text",
    "is_graded" boolean DEFAULT false,
    "coursework_average" numeric,
    "exam_average" numeric,
    "sort_order" bigint,
    "term_composite" numeric,
    "year_grade" numeric,
    "term_grade" numeric
);


ALTER TABLE "reporting"."report_book_entry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "reporting"."report_book_pdf" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_book_id" "uuid" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size" integer,
    "generated_by" "uuid" NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "reporting"."report_book_pdf" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "staff"."teacher_group_assignment" (
    "id" bigint NOT NULL,
    "user_profile_id" "uuid",
    "student_group_id" "uuid",
    "is_class_teacher" boolean,
    "academic_year_id" "uuid"
);


ALTER TABLE "staff"."teacher_group_assignment" OWNER TO "postgres";


COMMENT ON TABLE "staff"."teacher_group_assignment" IS 'Class Teacher can assign teachers to a group';



ALTER TABLE "staff"."teacher_group_assignment" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "staff"."teacher_group_assignment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "staff"."teacher_subject_assignment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_profile_id" "uuid",
    "subject_id" "uuid",
    "student_group_id" "uuid",
    "academic_year_id" "uuid"
);


ALTER TABLE "staff"."teacher_subject_assignment" OWNER TO "postgres";


COMMENT ON TABLE "staff"."teacher_subject_assignment" IS 'This allows the teacher that managing a particular class assign the teacher responsible for a particular subject';



CREATE TABLE IF NOT EXISTS "student"."parent_student_link" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_profile_id" "uuid",
    "student_id" "uuid",
    "relationship" "public"."relationship_type"
);


ALTER TABLE "student"."parent_student_link" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "student"."student" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "first_name" "text",
    "last_name" "text",
    "date_of_birth" "date",
    "gender" "text",
    "enrollement_date" "date",
    "is_active" boolean DEFAULT true
);


ALTER TABLE "student"."student" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "student"."student_group_enrollment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid",
    "enrolled_at" "date",
    "student_group_id" "uuid"
);


ALTER TABLE "student"."student_group_enrollment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "student"."student_subject_profile" (
    "id" bigint NOT NULL,
    "student_id" "uuid",
    "academic_year_id" "uuid",
    "subject_id" "uuid"
);


ALTER TABLE "student"."student_subject_profile" OWNER TO "postgres";


ALTER TABLE "student"."student_subject_profile" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "student"."student_subject_profile_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "grading"."assessment"
    ADD CONSTRAINT "assessment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "grading"."grade"
    ADD CONSTRAINT "grade_assessment_student_unique" UNIQUE ("assessment_id", "student_id");



ALTER TABLE ONLY "grading"."grade"
    ADD CONSTRAINT "grade_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."academic_year"
    ADD CONSTRAINT "academic_year_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."school"
    ADD CONSTRAINT "school_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_group"
    ADD CONSTRAINT "student_group_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subject"
    ADD CONSTRAINT "subject_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subject"
    ADD CONSTRAINT "subject_school_id_name_unique" UNIQUE ("school_id", "name");



ALTER TABLE ONLY "public"."term"
    ADD CONSTRAINT "term_academic_year_id_name_unique" UNIQUE ("academic_year_id", "name");



ALTER TABLE ONLY "public"."term"
    ADD CONSTRAINT "term_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "reporting"."class_report_file"
    ADD CONSTRAINT "class_report_file_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "reporting"."report_book_entry"
    ADD CONSTRAINT "report_book_entry_book_subject_key" UNIQUE ("report_book_id", "subject_id");



ALTER TABLE ONLY "reporting"."report_book_entry"
    ADD CONSTRAINT "report_book_entry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "reporting"."report_book_pdf"
    ADD CONSTRAINT "report_book_pdf_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "reporting"."report_book"
    ADD CONSTRAINT "report_book_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "reporting"."report_book"
    ADD CONSTRAINT "report_book_student_term_type_key" UNIQUE ("student_id", "term_id", "report_type");



ALTER TABLE ONLY "staff"."teacher_group_assignment"
    ADD CONSTRAINT "teacher_group_assignment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "staff"."teacher_subject_assignment"
    ADD CONSTRAINT "teacher_subject_assignment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "student"."parent_student_link"
    ADD CONSTRAINT "parent_student_link_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "student"."student_group_enrollment"
    ADD CONSTRAINT "student_group_enrollment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "student"."student_group_enrollment"
    ADD CONSTRAINT "student_group_enrollment_student_group_unique" UNIQUE ("student_id", "student_group_id");



ALTER TABLE ONLY "student"."student"
    ADD CONSTRAINT "student_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "student"."student_subject_profile"
    ADD CONSTRAINT "student_subject_profile_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_assessment_term_subject" ON "grading"."assessment" USING "btree" ("term_id", "subject_id");



CREATE INDEX "idx_grade_assessment" ON "grading"."grade" USING "btree" ("assessment_id");



CREATE INDEX "idx_academic_year_school" ON "public"."academic_year" USING "btree" ("school_id");



CREATE INDEX "idx_student_group_year" ON "public"."student_group" USING "btree" ("academic_year_id");



CREATE INDEX "idx_subject_school" ON "public"."subject" USING "btree" ("school_id");



CREATE INDEX "idx_term_year" ON "public"."term" USING "btree" ("academic_year_id");



CREATE INDEX "idx_user_profile_school" ON "public"."user_profile" USING "btree" ("school_id");



CREATE INDEX "idx_class_report_file_group_term" ON "reporting"."class_report_file" USING "btree" ("student_group_id", "term_id");



CREATE INDEX "idx_class_report_file_term" ON "reporting"."class_report_file" USING "btree" ("term_id");



CREATE INDEX "idx_report_book_year" ON "reporting"."report_book" USING "btree" ("academic_year_id");



CREATE INDEX "idx_report_entry_book" ON "reporting"."report_book_entry" USING "btree" ("report_book_id");



CREATE INDEX "idx_tga_user_group" ON "staff"."teacher_group_assignment" USING "btree" ("user_profile_id", "student_group_id");



CREATE INDEX "idx_tga_user_group_class" ON "staff"."teacher_group_assignment" USING "btree" ("user_profile_id", "student_group_id", "is_class_teacher");



CREATE INDEX "idx_tga_year" ON "staff"."teacher_group_assignment" USING "btree" ("academic_year_id");



CREATE INDEX "idx_tsa_user_subject_group" ON "staff"."teacher_subject_assignment" USING "btree" ("user_profile_id", "subject_id", "student_group_id");



CREATE INDEX "idx_tsa_year" ON "staff"."teacher_subject_assignment" USING "btree" ("academic_year_id");



CREATE INDEX "idx_enrollment_group" ON "student"."student_group_enrollment" USING "btree" ("student_group_id");



CREATE INDEX "idx_enrollment_student" ON "student"."student_group_enrollment" USING "btree" ("student_id");



CREATE INDEX "idx_parent_link_student" ON "student"."parent_student_link" USING "btree" ("student_id");



CREATE INDEX "idx_ssp_year" ON "student"."student_subject_profile" USING "btree" ("academic_year_id");



CREATE INDEX "idx_student_school" ON "student"."student" USING "btree" ("school_id");



ALTER TABLE ONLY "grading"."assessment"
    ADD CONSTRAINT "assessment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id");



ALTER TABLE ONLY "grading"."assessment"
    ADD CONSTRAINT "assessment_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id");



ALTER TABLE ONLY "grading"."grade"
    ADD CONSTRAINT "grade_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "grading"."assessment"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "grading"."grade"
    ADD CONSTRAINT "grade_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "grading"."grade"
    ADD CONSTRAINT "grade_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "grading"."grade"
    ADD CONSTRAINT "grade_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."academic_year"
    ADD CONSTRAINT "academic_year_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_group"
    ADD CONSTRAINT "student_group_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id");



ALTER TABLE ONLY "public"."student_group"
    ADD CONSTRAINT "student_group_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subject"
    ADD CONSTRAINT "subject_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."term"
    ADD CONSTRAINT "term_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id");



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "user_profile_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "user_profile_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "reporting"."class_report_file"
    ADD CONSTRAINT "class_report_file_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "reporting"."class_report_file"
    ADD CONSTRAINT "class_report_file_student_group_id_fkey" FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id");



ALTER TABLE ONLY "reporting"."class_report_file"
    ADD CONSTRAINT "class_report_file_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id");



ALTER TABLE ONLY "reporting"."report_book"
    ADD CONSTRAINT "report_book_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id");



ALTER TABLE ONLY "reporting"."report_book"
    ADD CONSTRAINT "report_book_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "reporting"."report_book_entry"
    ADD CONSTRAINT "report_book_entry_report_book_id_fkey" FOREIGN KEY ("report_book_id") REFERENCES "reporting"."report_book"("id");



ALTER TABLE ONLY "reporting"."report_book_entry"
    ADD CONSTRAINT "report_book_entry_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id");



ALTER TABLE ONLY "reporting"."report_book_pdf"
    ADD CONSTRAINT "report_book_pdf_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "public"."user_profile"("id");



ALTER TABLE ONLY "reporting"."report_book_pdf"
    ADD CONSTRAINT "report_book_pdf_report_book_id_fkey" FOREIGN KEY ("report_book_id") REFERENCES "reporting"."report_book"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "reporting"."report_book"
    ADD CONSTRAINT "report_book_student_group_id_fkey" FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "reporting"."report_book"
    ADD CONSTRAINT "report_book_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "reporting"."report_book"
    ADD CONSTRAINT "report_book_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id");



ALTER TABLE ONLY "staff"."teacher_group_assignment"
    ADD CONSTRAINT "teacher_group_assignment_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id");



ALTER TABLE ONLY "staff"."teacher_group_assignment"
    ADD CONSTRAINT "teacher_group_assignment_student_group_id_fkey" FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id");



ALTER TABLE ONLY "staff"."teacher_group_assignment"
    ADD CONSTRAINT "teacher_group_assignment_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "staff"."teacher_subject_assignment"
    ADD CONSTRAINT "teacher_subject_assignment_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id");



ALTER TABLE ONLY "staff"."teacher_subject_assignment"
    ADD CONSTRAINT "teacher_subject_assignment_student_group_id_fkey" FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id");



ALTER TABLE ONLY "staff"."teacher_subject_assignment"
    ADD CONSTRAINT "teacher_subject_assignment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id");



ALTER TABLE ONLY "staff"."teacher_subject_assignment"
    ADD CONSTRAINT "teacher_subject_assignment_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "student"."parent_student_link"
    ADD CONSTRAINT "parent_student_link_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "student"."parent_student_link"
    ADD CONSTRAINT "parent_student_link_user_profile_id_fkey" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "student"."student_group_enrollment"
    ADD CONSTRAINT "student_group_enrollment_student_group_id_fkey" FOREIGN KEY ("student_group_id") REFERENCES "public"."student_group"("id");



ALTER TABLE ONLY "student"."student_group_enrollment"
    ADD CONSTRAINT "student_group_enrollment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "student"."student"
    ADD CONSTRAINT "student_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "student"."student_subject_profile"
    ADD CONSTRAINT "student_subject_profile_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id");



ALTER TABLE ONLY "student"."student_subject_profile"
    ADD CONSTRAINT "student_subject_profile_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "student"."student_subject_profile"
    ADD CONSTRAINT "student_subject_profile_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE CASCADE;



ALTER TABLE "grading"."assessment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assignment_read" ON "grading"."assessment" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM ("staff"."teacher_subject_assignment" "tsa"
     JOIN "public"."term" "t" ON (("t"."academic_year_id" = "tsa"."academic_year_id")))
  WHERE (("tsa"."user_profile_id" = "auth"."uid"()) AND ("tsa"."subject_id" = "assessment"."subject_id") AND ("t"."id" = "assessment"."term_id")))) OR (EXISTS ( SELECT 1
   FROM ("staff"."teacher_group_assignment" "tga"
     JOIN "public"."term" "t" ON (("t"."academic_year_id" = "tga"."academic_year_id")))
  WHERE (("tga"."user_profile_id" = "auth"."uid"()) AND ("tga"."is_class_teacher" = true) AND ("t"."id" = "assessment"."term_id"))))));



CREATE POLICY "assignment_read" ON "grading"."grade" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM (("grading"."assessment" "a"
     JOIN "staff"."teacher_subject_assignment" "tsa" ON (("tsa"."subject_id" = "a"."subject_id")))
     JOIN "public"."term" "t" ON ((("t"."id" = "a"."term_id") AND ("t"."academic_year_id" = "tsa"."academic_year_id"))))
  WHERE (("tsa"."user_profile_id" = "auth"."uid"()) AND ("a"."id" = "grade"."assessment_id")))) OR (EXISTS ( SELECT 1
   FROM ("student"."student_group_enrollment" "sge"
     JOIN "staff"."teacher_group_assignment" "tga" ON ((("tga"."student_group_id" = "sge"."student_group_id") AND ("tga"."is_class_teacher" = true))))
  WHERE (("tga"."user_profile_id" = "auth"."uid"()) AND ("sge"."student_id" = "grade"."student_id"))))));



CREATE POLICY "assignment_update" ON "grading"."assessment" FOR UPDATE USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM ("staff"."teacher_subject_assignment" "tsa"
     JOIN "public"."term" "t" ON (("t"."academic_year_id" = "tsa"."academic_year_id")))
  WHERE (("tsa"."user_profile_id" = "auth"."uid"()) AND ("tsa"."subject_id" = "assessment"."subject_id") AND ("t"."id" = "assessment"."term_id"))))));



CREATE POLICY "assignment_update" ON "grading"."grade" FOR UPDATE USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM (("grading"."assessment" "a"
     JOIN "staff"."teacher_subject_assignment" "tsa" ON (("tsa"."subject_id" = "a"."subject_id")))
     JOIN "public"."term" "t" ON ((("t"."id" = "a"."term_id") AND ("t"."academic_year_id" = "tsa"."academic_year_id"))))
  WHERE (("tsa"."user_profile_id" = "auth"."uid"()) AND ("a"."id" = "grade"."assessment_id"))))));



CREATE POLICY "assignment_write" ON "grading"."assessment" FOR INSERT WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM ("staff"."teacher_subject_assignment" "tsa"
     JOIN "public"."term" "t" ON (("t"."academic_year_id" = "tsa"."academic_year_id")))
  WHERE (("tsa"."user_profile_id" = "auth"."uid"()) AND ("tsa"."subject_id" = "tsa"."subject_id") AND ("t"."id" = "assessment"."term_id"))))));



CREATE POLICY "assignment_write" ON "grading"."grade" FOR INSERT WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM (("grading"."assessment" "a"
     JOIN "staff"."teacher_subject_assignment" "tsa" ON (("tsa"."subject_id" = "a"."subject_id")))
     JOIN "public"."term" "t" ON ((("t"."id" = "a"."term_id") AND ("t"."academic_year_id" = "tsa"."academic_year_id"))))
  WHERE (("tsa"."user_profile_id" = "auth"."uid"()) AND ("a"."id" = "grade"."assessment_id"))))));



ALTER TABLE "grading"."grade" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "school_isolation" ON "grading"."assessment" USING ((EXISTS ( SELECT 1
   FROM ("public"."term" "t"
     JOIN "public"."academic_year" "ay" ON (("ay"."id" = "t"."academic_year_id")))
  WHERE (("t"."id" = "assessment"."term_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "grading"."grade" USING ((EXISTS ( SELECT 1
   FROM (("grading"."assessment" "a"
     JOIN "public"."term" "t" ON (("t"."id" = "a"."term_id")))
     JOIN "public"."academic_year" "ay" ON (("ay"."id" = "t"."academic_year_id")))
  WHERE (("a"."id" = "grade"."assessment_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



ALTER TABLE "public"."academic_year" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."school" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "school_isolation" ON "public"."academic_year" USING (("school_id" = "public"."get_user_school_id"()));



CREATE POLICY "school_isolation" ON "public"."school" USING (("id" = "public"."get_user_school_id"()));



CREATE POLICY "school_isolation" ON "public"."student_group" USING ((EXISTS ( SELECT 1
   FROM "public"."academic_year" "ay"
  WHERE (("ay"."id" = "student_group"."academic_year_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "public"."subject" USING (("school_id" = "public"."get_user_school_id"()));



CREATE POLICY "school_isolation" ON "public"."term" USING ((EXISTS ( SELECT 1
   FROM "public"."academic_year" "ay"
  WHERE (("ay"."id" = "term"."academic_year_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "public"."user_profile" USING (("school_id" = "public"."get_user_school_id"()));



ALTER TABLE "public"."student_group" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subject" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."term" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profile" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assignment_read" ON "reporting"."class_report_file" FOR SELECT USING (("public"."is_admin"() OR "public"."is_assigned_to_group"("student_group_id")));



CREATE POLICY "assignment_read" ON "reporting"."report_book" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "student"."student_group_enrollment" "sge"
  WHERE (("sge"."student_id" = "report_book"."student_id") AND "public"."is_assigned_to_group"("sge"."student_group_id"))))));



CREATE POLICY "assignment_read" ON "reporting"."report_book_entry" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM ("reporting"."report_book" "rb"
     JOIN "student"."student_group_enrollment" "sge" ON (("sge"."student_id" = "rb"."student_id")))
  WHERE (("rb"."id" = "report_book_entry"."report_book_id") AND "public"."is_assigned_to_group"("sge"."student_group_id"))))));



ALTER TABLE "reporting"."class_report_file" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "reporting"."report_book" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "reporting"."report_book_entry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "reporting"."report_book_pdf" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "school_isolation" ON "reporting"."class_report_file" USING ((EXISTS ( SELECT 1
   FROM ("public"."term" "t"
     JOIN "public"."academic_year" "ay" ON (("ay"."id" = "t"."academic_year_id")))
  WHERE (("t"."id" = "class_report_file"."term_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "reporting"."report_book" USING ((EXISTS ( SELECT 1
   FROM "public"."academic_year" "ay"
  WHERE (("ay"."id" = "report_book"."academic_year_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "reporting"."report_book_entry" USING ((EXISTS ( SELECT 1
   FROM ("reporting"."report_book" "rb"
     JOIN "public"."academic_year" "ay" ON (("ay"."id" = "rb"."academic_year_id")))
  WHERE (("rb"."id" = "report_book_entry"."report_book_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "reporting"."report_book_pdf" USING ((EXISTS ( SELECT 1
   FROM ("reporting"."report_book" "rb"
     JOIN "public"."academic_year" "ay" ON (("ay"."id" = "rb"."academic_year_id")))
  WHERE (("rb"."id" = "report_book_pdf"."report_book_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "staff"."teacher_group_assignment" USING ((EXISTS ( SELECT 1
   FROM "public"."academic_year" "ay"
  WHERE (("ay"."id" = "teacher_group_assignment"."academic_year_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "staff"."teacher_subject_assignment" USING ((EXISTS ( SELECT 1
   FROM "public"."academic_year" "ay"
  WHERE (("ay"."id" = "teacher_subject_assignment"."academic_year_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



ALTER TABLE "staff"."teacher_group_assignment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "staff"."teacher_subject_assignment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assignment_isolation" ON "student"."parent_student_link" FOR SELECT USING (("public"."is_admin"() OR ("user_profile_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "student"."student_group_enrollment" "sge"
  WHERE (("sge"."student_id" = "parent_student_link"."student_id") AND "public"."is_assigned_to_group"("sge"."student_group_id"))))));



CREATE POLICY "assignment_isolation" ON "student"."student" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "student"."student_group_enrollment" "sge"
  WHERE (("sge"."student_id" = "student"."id") AND "public"."is_assigned_to_group"("sge"."student_group_id"))))));



CREATE POLICY "assignment_isolation" ON "student"."student_group_enrollment" FOR SELECT USING (("public"."is_admin"() OR "public"."is_assigned_to_group"("student_group_id")));



CREATE POLICY "assignment_isolation" ON "student"."student_subject_profile" FOR SELECT USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "student"."student_group_enrollment" "sge"
  WHERE (("sge"."student_id" = "student_subject_profile"."student_id") AND "public"."is_assigned_to_group"("sge"."student_group_id"))))));



ALTER TABLE "student"."parent_student_link" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "school_isolation" ON "student"."parent_student_link" USING ((EXISTS ( SELECT 1
   FROM "student"."student" "s"
  WHERE (("s"."id" = "parent_student_link"."student_id") AND ("s"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "student"."student" USING (("school_id" = "public"."get_user_school_id"()));



CREATE POLICY "school_isolation" ON "student"."student_group_enrollment" USING ((EXISTS ( SELECT 1
   FROM ("public"."student_group" "sg"
     JOIN "public"."academic_year" "ay" ON (("ay"."id" = "sg"."academic_year_id")))
  WHERE (("sg"."id" = "student_group_enrollment"."student_group_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



CREATE POLICY "school_isolation" ON "student"."student_subject_profile" USING ((EXISTS ( SELECT 1
   FROM "public"."academic_year" "ay"
  WHERE (("ay"."id" = "student_subject_profile"."academic_year_id") AND ("ay"."school_id" = "public"."get_user_school_id"())))));



ALTER TABLE "student"."student" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "student"."student_group_enrollment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "student"."student_subject_profile" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "grading" TO "authenticated";
GRANT USAGE ON SCHEMA "grading" TO "anon";
GRANT USAGE ON SCHEMA "grading" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT USAGE ON SCHEMA "reporting" TO "authenticated";
GRANT USAGE ON SCHEMA "reporting" TO "anon";
GRANT USAGE ON SCHEMA "reporting" TO "service_role";



GRANT USAGE ON SCHEMA "staff" TO "authenticated";
GRANT USAGE ON SCHEMA "staff" TO "anon";
GRANT USAGE ON SCHEMA "staff" TO "service_role";



GRANT USAGE ON SCHEMA "student" TO "authenticated";
GRANT USAGE ON SCHEMA "student" TO "anon";
GRANT USAGE ON SCHEMA "student" TO "service_role";





















































































































































































































































































































GRANT ALL ON FUNCTION "public"."get_user_school_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_school_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_school_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_assigned_to_group"("p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_assigned_to_group"("p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_assigned_to_group"("p_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_assigned_to_subject_in_group"("p_subject_id" "uuid", "p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_assigned_to_subject_in_group"("p_subject_id" "uuid", "p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_assigned_to_subject_in_group"("p_subject_id" "uuid", "p_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";





















GRANT ALL ON TABLE "grading"."assessment" TO "authenticated";
GRANT ALL ON TABLE "grading"."assessment" TO "anon";
GRANT ALL ON TABLE "grading"."assessment" TO "service_role";



GRANT ALL ON TABLE "grading"."grade" TO "authenticated";
GRANT ALL ON TABLE "grading"."grade" TO "anon";
GRANT ALL ON TABLE "grading"."grade" TO "service_role";



GRANT ALL ON TABLE "public"."academic_year" TO "anon";
GRANT ALL ON TABLE "public"."academic_year" TO "authenticated";
GRANT ALL ON TABLE "public"."academic_year" TO "service_role";



GRANT ALL ON TABLE "public"."school" TO "anon";
GRANT ALL ON TABLE "public"."school" TO "authenticated";
GRANT ALL ON TABLE "public"."school" TO "service_role";



GRANT ALL ON TABLE "public"."student_group" TO "anon";
GRANT ALL ON TABLE "public"."student_group" TO "authenticated";
GRANT ALL ON TABLE "public"."student_group" TO "service_role";



GRANT ALL ON TABLE "public"."subject" TO "anon";
GRANT ALL ON TABLE "public"."subject" TO "authenticated";
GRANT ALL ON TABLE "public"."subject" TO "service_role";



GRANT ALL ON TABLE "public"."term" TO "anon";
GRANT ALL ON TABLE "public"."term" TO "authenticated";
GRANT ALL ON TABLE "public"."term" TO "service_role";



GRANT ALL ON TABLE "public"."user_profile" TO "anon";
GRANT ALL ON TABLE "public"."user_profile" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profile" TO "service_role";



GRANT ALL ON TABLE "reporting"."class_report_file" TO "anon";
GRANT ALL ON TABLE "reporting"."class_report_file" TO "authenticated";
GRANT ALL ON TABLE "reporting"."class_report_file" TO "service_role";



GRANT ALL ON TABLE "reporting"."report_book" TO "authenticated";
GRANT ALL ON TABLE "reporting"."report_book" TO "anon";
GRANT ALL ON TABLE "reporting"."report_book" TO "service_role";



GRANT ALL ON TABLE "reporting"."report_book_entry" TO "authenticated";
GRANT ALL ON TABLE "reporting"."report_book_entry" TO "anon";
GRANT ALL ON TABLE "reporting"."report_book_entry" TO "service_role";



GRANT ALL ON TABLE "reporting"."report_book_pdf" TO "anon";
GRANT ALL ON TABLE "reporting"."report_book_pdf" TO "authenticated";
GRANT ALL ON TABLE "reporting"."report_book_pdf" TO "service_role";



GRANT ALL ON TABLE "staff"."teacher_group_assignment" TO "authenticated";
GRANT ALL ON TABLE "staff"."teacher_group_assignment" TO "anon";
GRANT ALL ON TABLE "staff"."teacher_group_assignment" TO "service_role";



GRANT ALL ON TABLE "staff"."teacher_subject_assignment" TO "authenticated";
GRANT ALL ON TABLE "staff"."teacher_subject_assignment" TO "anon";
GRANT ALL ON TABLE "staff"."teacher_subject_assignment" TO "service_role";



GRANT ALL ON TABLE "student"."parent_student_link" TO "authenticated";
GRANT ALL ON TABLE "student"."parent_student_link" TO "anon";
GRANT ALL ON TABLE "student"."parent_student_link" TO "service_role";



GRANT ALL ON TABLE "student"."student" TO "authenticated";
GRANT ALL ON TABLE "student"."student" TO "anon";
GRANT ALL ON TABLE "student"."student" TO "service_role";



GRANT ALL ON TABLE "student"."student_group_enrollment" TO "authenticated";
GRANT ALL ON TABLE "student"."student_group_enrollment" TO "anon";
GRANT ALL ON TABLE "student"."student_group_enrollment" TO "service_role";



GRANT ALL ON TABLE "student"."student_subject_profile" TO "authenticated";
GRANT ALL ON TABLE "student"."student_subject_profile" TO "anon";
GRANT ALL ON TABLE "student"."student_subject_profile" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "grading" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "grading" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "grading" GRANT ALL ON TABLES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "reporting" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "reporting" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "reporting" GRANT ALL ON TABLES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "staff" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "staff" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "staff" GRANT ALL ON TABLES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "student" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "student" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "student" GRANT ALL ON TABLES TO "service_role";
































