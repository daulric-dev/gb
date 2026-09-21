-- Student accounts, phase 1: data model only.
--
-- Account type is deliberately a separate axis from public.role. `role`
-- (admin/teacher/member) drives AdminGuard, ROLE_DEFAULTS, school_management
-- and the staff roster; folding students into it would leak them into all of
-- that. A student has account_type='student' and no school_management row, so
-- PermissionGuard denies every catalog-guarded route by default.

CREATE TYPE "public"."account_type" AS ENUM ('staff', 'student');

ALTER TABLE "public"."user_profile"
  ADD COLUMN IF NOT EXISTS "account_type" "public"."account_type"
  NOT NULL DEFAULT 'staff';

COMMENT ON COLUMN "public"."user_profile"."account_type" IS
  'Which onboarding flow and API surface this login belongs to. `role` is only meaningful when account_type = ''staff''.';

-- Link a login to the student record it represents. Nullable: student records
-- exist long before (and often without) an account. ON DELETE SET NULL so
-- deleting an account never cascades into losing the academic record.
ALTER TABLE "student"."student"
  ADD COLUMN IF NOT EXISTS "user_profile_id" "uuid";

ALTER TABLE "student"."student"
  DROP CONSTRAINT IF EXISTS "student_user_profile_id_fkey";

ALTER TABLE "student"."student"
  ADD CONSTRAINT "student_user_profile_id_fkey"
  FOREIGN KEY ("user_profile_id")
  REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

-- One account per student record, and one student record per account,
-- enforced in the database rather than in service code.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_student_user_profile_unique"
  ON "student"."student"("user_profile_id")
  WHERE "user_profile_id" IS NOT NULL;

-- School-issued codes a student redeems to claim their record. Codes are
-- stored hashed: a leaked database row must not be redeemable.
CREATE TABLE IF NOT EXISTS "student"."student_claim_code" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "redeemed_at" timestamp with time zone,
    "redeemed_by" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text") NOT NULL
);

ALTER TABLE "student"."student_claim_code" OWNER TO "postgres";

ALTER TABLE "student"."student_claim_code"
  ADD CONSTRAINT "student_claim_code_pkey" PRIMARY KEY ("id");

ALTER TABLE "student"."student_claim_code"
  ADD CONSTRAINT "student_claim_code_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE "student"."student_claim_code"
  ADD CONSTRAINT "student_claim_code_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "student"."student"("id") ON DELETE CASCADE;

ALTER TABLE "student"."student_claim_code"
  ADD CONSTRAINT "student_claim_code_redeemed_by_fkey"
  FOREIGN KEY ("redeemed_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

ALTER TABLE "student"."student_claim_code"
  ADD CONSTRAINT "student_claim_code_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE RESTRICT;

-- A redeemed code records who redeemed it; an unredeemed one must not.
ALTER TABLE "student"."student_claim_code"
  ADD CONSTRAINT "student_claim_code_redemption_consistent"
  CHECK (("redeemed_at" IS NULL) = ("redeemed_by" IS NULL));

-- At most one outstanding code per student, so reissuing supersedes rather
-- than accumulating redeemable codes.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_student_claim_code_one_active"
  ON "student"."student_claim_code"("student_id")
  WHERE "redeemed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_student_claim_code_school"
  ON "student"."student_claim_code"("school_id");

-- Lookup path for redemption.
CREATE INDEX IF NOT EXISTS "idx_student_claim_code_hash"
  ON "student"."student_claim_code"("code_hash");

-- No policies: the API reaches this table through the service client only.
-- Enabling RLS denies anon/authenticated outright, matching the other
-- student.* tables.
ALTER TABLE "student"."student_claim_code" ENABLE ROW LEVEL SECURITY;
