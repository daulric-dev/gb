-- Custom grade scales per school. A school can define one or more scales
-- (letter, GPA, pass/fail) and mark one as the default. Scales are made of
-- bands that map a percentage range to a label (and optional GPA points /
-- pass flag). Numeric display is the absence of an active scale.
--
-- Conversion happens at read time (Option A): the grades table still stores
-- the numeric score; the active scale is looked up to map to a band on the
-- way out. The expected caching layer is Redis at the service tier.

CREATE TYPE "public"."grade_scale_type" AS ENUM (
    'letter',
    'gpa',
    'pass_fail'
);

ALTER TYPE "public"."grade_scale_type" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "grading"."grade_scale" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "scale_type" "public"."grade_scale_type" NOT NULL,
    "is_default" boolean NOT NULL DEFAULT false,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);

ALTER TABLE "grading"."grade_scale" OWNER TO "postgres";

ALTER TABLE ONLY "grading"."grade_scale"
    ADD CONSTRAINT "grade_scale_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "grading"."grade_scale"
    ADD CONSTRAINT "grade_scale_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "grading"."grade_scale"
    ADD CONSTRAINT "grade_scale_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "grading"."grade_scale"
    ADD CONSTRAINT "grade_scale_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "public"."user_profile"("id") ON DELETE SET NULL;

-- One default scale per school. Lets multiple non-defaults coexist.
CREATE UNIQUE INDEX "grade_scale_one_default_per_school"
  ON "grading"."grade_scale" ("school_id")
  WHERE "is_default" = true;

CREATE INDEX "idx_grade_scale_school" ON "grading"."grade_scale"
  USING "btree" ("school_id");

CREATE TABLE IF NOT EXISTS "grading"."grade_scale_band" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "grade_scale_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "min_percentage" numeric(5, 2) NOT NULL,
    "max_percentage" numeric(5, 2) NOT NULL,
    "gpa_points" numeric(4, 2),
    "is_pass" boolean NOT NULL DEFAULT true,
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text"),
    CONSTRAINT "grade_scale_band_range_valid"
      CHECK ("min_percentage" >= 0 AND "max_percentage" <= 100
             AND "min_percentage" <= "max_percentage")
);

ALTER TABLE "grading"."grade_scale_band" OWNER TO "postgres";

ALTER TABLE ONLY "grading"."grade_scale_band"
    ADD CONSTRAINT "grade_scale_band_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "grading"."grade_scale_band"
    ADD CONSTRAINT "grade_scale_band_scale_label_unique"
    UNIQUE ("grade_scale_id", "label");

ALTER TABLE ONLY "grading"."grade_scale_band"
    ADD CONSTRAINT "grade_scale_band_scale_fkey"
    FOREIGN KEY ("grade_scale_id") REFERENCES "grading"."grade_scale"("id") ON DELETE CASCADE;

CREATE INDEX "idx_grade_scale_band_scale" ON "grading"."grade_scale_band"
  USING "btree" ("grade_scale_id", "sort_order");

ALTER TABLE "grading"."grade_scale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grading"."grade_scale_band" ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user whose profile is in the same school can
-- see the school's scales (teachers need them to display converted grades).
CREATE POLICY "school_isolation_read" ON "grading"."grade_scale"
  FOR SELECT
  USING ("school_id" = "public"."get_user_school_id"());

-- Write: only admins in the same school.
CREATE POLICY "admin_write_insert" ON "grading"."grade_scale"
  FOR INSERT
  WITH CHECK (
    "public"."is_admin"()
    AND "school_id" = "public"."get_user_school_id"()
  );

CREATE POLICY "admin_write_update" ON "grading"."grade_scale"
  FOR UPDATE
  USING (
    "public"."is_admin"()
    AND "school_id" = "public"."get_user_school_id"()
  );

CREATE POLICY "admin_write_delete" ON "grading"."grade_scale"
  FOR DELETE
  USING (
    "public"."is_admin"()
    AND "school_id" = "public"."get_user_school_id"()
  );

-- Bands inherit scope through their parent scale.
CREATE POLICY "school_isolation_read" ON "grading"."grade_scale_band"
  FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM "grading"."grade_scale" "gs"
    WHERE "gs"."id" = "grade_scale_band"."grade_scale_id"
      AND "gs"."school_id" = "public"."get_user_school_id"()
  ));

CREATE POLICY "admin_write_insert" ON "grading"."grade_scale_band"
  FOR INSERT
  WITH CHECK (
    "public"."is_admin"()
    AND EXISTS (
      SELECT 1
      FROM "grading"."grade_scale" "gs"
      WHERE "gs"."id" = "grade_scale_band"."grade_scale_id"
        AND "gs"."school_id" = "public"."get_user_school_id"()
    )
  );

CREATE POLICY "admin_write_update" ON "grading"."grade_scale_band"
  FOR UPDATE
  USING (
    "public"."is_admin"()
    AND EXISTS (
      SELECT 1
      FROM "grading"."grade_scale" "gs"
      WHERE "gs"."id" = "grade_scale_band"."grade_scale_id"
        AND "gs"."school_id" = "public"."get_user_school_id"()
    )
  );

CREATE POLICY "admin_write_delete" ON "grading"."grade_scale_band"
  FOR DELETE
  USING (
    "public"."is_admin"()
    AND EXISTS (
      SELECT 1
      FROM "grading"."grade_scale" "gs"
      WHERE "gs"."id" = "grade_scale_band"."grade_scale_id"
        AND "gs"."school_id" = "public"."get_user_school_id"()
    )
  );

GRANT ALL ON TYPE "public"."grade_scale_type" TO "anon";
GRANT ALL ON TYPE "public"."grade_scale_type" TO "authenticated";
GRANT ALL ON TYPE "public"."grade_scale_type" TO "service_role";

GRANT ALL ON TABLE "grading"."grade_scale" TO "authenticated";
GRANT ALL ON TABLE "grading"."grade_scale" TO "anon";
GRANT ALL ON TABLE "grading"."grade_scale" TO "service_role";

GRANT ALL ON TABLE "grading"."grade_scale_band" TO "authenticated";
GRANT ALL ON TABLE "grading"."grade_scale_band" TO "anon";
GRANT ALL ON TABLE "grading"."grade_scale_band" TO "service_role";
