-- Removes the subject profiles orphaned by the old ON DELETE SET NULL rule,
-- and stops the table accepting another one.
--
-- 20260921120000 changed student_subject_profile.student_id from SET NULL to
-- CASCADE, so deleting a student no longer leaves a row behind. It deliberately
-- left the rows the old rule had already produced, because changing a rule and
-- deleting data are different decisions. This is the second one.
--
-- The table is a three-way link - this student takes this subject in this year.
-- Every read in the application filters on all three columns with = or IN, and
-- NULL satisfies neither, so a row missing any of them is unreachable: it
-- cannot appear in a class list, a subject assignment or a calculation. It is
-- not partial data, it is data nothing can ever load.
--
-- Both insert paths (assignSubjects, bulk assignment) always populate all
-- three, so nothing in the application can produce a row this deletes, and
-- nothing is broken by refusing one.

-- Unreachable by construction; see above.
DELETE FROM "student"."student_subject_profile"
 WHERE "student_id" IS NULL
    OR "subject_id" IS NULL
    OR "academic_year_id" IS NULL;

-- With the rows gone and every cascade now deleting rather than nulling, the
-- columns can say so. This is what makes the fix permanent rather than a sweep
-- that has to be repeated the next time a rule is wrong.
--
-- This depends on 20260921120000 having run first. NOT NULL and the old
-- ON DELETE SET NULL are contradictory: with both in place, deleting a student
-- would try to null a column that refuses nulls and fail. Ordering makes that
-- impossible here, but it is the reason these are two migrations and not one
-- statement moved earlier.
ALTER TABLE "student"."student_subject_profile"
  ALTER COLUMN "student_id" SET NOT NULL,
  ALTER COLUMN "subject_id" SET NOT NULL,
  ALTER COLUMN "academic_year_id" SET NOT NULL;
