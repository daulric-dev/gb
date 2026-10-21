-- Carry the class/subject gradebook across to courses.
--
-- Every step is idempotent (ON CONFLICT DO NOTHING, or guarded by a NULL
-- check), so re-running this against a partly migrated database finishes the
-- job instead of duplicating it. Nothing here deletes; the source tables are
-- dropped by a later cleanup migration once this has been verified.
--
-- Not carried across: report books and their PDFs, class report files and
-- class attendance. They stay in their tables until that cleanup.

-- ── 1. courses: one per (class, subject) pair with evidence of use ──────────
--
-- Evidence is a subject teacher assigned to the class, work set for it, or a
-- mark recorded for a student in it. A subject nobody taught to a class and
-- nobody was marked in is not a course anyone would recognise.

WITH pairs AS (
  SELECT tsa.student_group_id AS group_id, tsa.subject_id
  FROM staff.teacher_subject_assignment tsa
  WHERE tsa.student_group_id IS NOT NULL AND tsa.subject_id IS NOT NULL
  UNION
  SELECT a.student_group_id, a.subject_id
  FROM grading.activity a
  WHERE a.student_group_id IS NOT NULL AND a.subject_id IS NOT NULL
  UNION
  SELECT e.student_group_id, s.subject_id
  FROM grading.grade g
  JOIN grading.assessment s ON s.id = g.assessment_id
  JOIN public.term t ON t.id = s.term_id
  JOIN student.student_group_enrollment e ON e.student_id = g.student_id
  JOIN public.student_group sg
    ON sg.id = e.student_group_id AND sg.academic_year_id = t.academic_year_id
  WHERE s.subject_id IS NOT NULL
)
INSERT INTO course.course (
  school_id, academic_year_id, name, code, status, created_by,
  created_at, legacy_student_group_id, legacy_subject_id
)
SELECT
  ay.school_id,
  sg.academic_year_id,
  COALESCE(NULLIF(btrim(s.name), ''), 'Subject') || ' - ' || COALESCE(NULLIF(btrim(sg.name), ''), 'Class'),
  s.code,
  -- Past years' courses are finished; only the current year stays live.
  (CASE WHEN ay.is_active THEN 'published' ELSE 'archived' END)::course.course_status,
  sg.created_by,
  COALESCE(sg.created_at, now()),
  sg.id,
  s.id
FROM pairs p
JOIN public.student_group sg ON sg.id = p.group_id
JOIN public.academic_year ay ON ay.id = sg.academic_year_id
-- A subject from another school paired with this class is bad data, not a
-- course; leave it behind.
JOIN public.subject s ON s.id = p.subject_id AND s.school_id = ay.school_id
WHERE ay.school_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 2. course staff ─────────────────────────────────────────────────────────

-- Subject teachers teach the course.
INSERT INTO course.course_staff (course_id, user_profile_id, role)
SELECT DISTINCT c.id, tsa.user_profile_id, 'teacher'::course.course_staff_role
FROM staff.teacher_subject_assignment tsa
JOIN course.course c
  ON c.legacy_student_group_id = tsa.student_group_id
 AND c.legacy_subject_id = tsa.subject_id
WHERE tsa.user_profile_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- The class teacher could see every mark in the class, so they keep read and
-- marking access to each of its courses as a TA.
INSERT INTO course.course_staff (course_id, user_profile_id, role)
SELECT DISTINCT c.id, tga.user_profile_id, 'ta'::course.course_staff_role
FROM staff.teacher_group_assignment tga
JOIN course.course c ON c.legacy_student_group_id = tga.student_group_id
WHERE tga.is_class_teacher AND tga.user_profile_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 3. course students ──────────────────────────────────────────────────────
--
-- A student in the class takes the course, unless the school recorded which
-- subjects they take that year and this is not one of them.

INSERT INTO course.course_student (course_id, student_id, status, enrolled_at)
SELECT
  c.id,
  e.student_id,
  'active'::course.course_student_status,
  COALESCE(e.enrolled_at::timestamp with time zone, now())
FROM course.course c
JOIN student.student_group_enrollment e ON e.student_group_id = c.legacy_student_group_id
WHERE e.student_id IS NOT NULL
  AND (
    NOT EXISTS (
      SELECT 1 FROM student.student_subject_profile p
      WHERE p.student_id = e.student_id AND p.academic_year_id = c.academic_year_id
    )
    OR EXISTS (
      SELECT 1 FROM student.student_subject_profile p
      WHERE p.student_id = e.student_id
        AND p.academic_year_id = c.academic_year_id
        AND p.subject_id = c.legacy_subject_id
    )
  )
ON CONFLICT DO NOTHING;

-- ── 4. assignment groups ────────────────────────────────────────────────────
--
-- A class used its own grading groups in a term if it had any, otherwise the
-- term's defaults. Terms collapse into one course, so groups are merged by
-- name and the earliest term decides the weight.

INSERT INTO course.assignment_group (course_id, name, weight, position)
SELECT DISTINCT ON (c.id, lower(gg.name))
  c.id, btrim(gg.name), gg.weight, COALESCE(gg.sort_order, 0)
FROM course.course c
JOIN public.term t ON t.academic_year_id = c.academic_year_id
JOIN grading.grading_group gg
  ON gg.term_id = t.id
 AND (
   gg.student_group_id = c.legacy_student_group_id
   OR (
     gg.student_group_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM grading.grading_group own
       WHERE own.term_id = t.id AND own.student_group_id = c.legacy_student_group_id
     )
   )
 )
WHERE c.legacy_student_group_id IS NOT NULL
  AND btrim(COALESCE(gg.name, '')) <> ''
ORDER BY c.id, lower(gg.name), t.sort_order NULLS LAST, t.start_date NULLS LAST
ON CONFLICT DO NOTHING;

-- ── 5. activities move onto their course ────────────────────────────────────

UPDATE grading.activity a
SET course_id = c.id
FROM course.course c
WHERE a.course_id IS NULL
  AND c.legacy_student_group_id = a.student_group_id
  AND c.legacy_subject_id = a.subject_id;

-- Whoever set work in a course taught it, even without an assignment row.
-- The class teacher may already be a TA there; that row stays as it is.
INSERT INTO course.course_staff (course_id, user_profile_id, role)
SELECT DISTINCT a.course_id, a.created_by, 'teacher'::course.course_staff_role
FROM grading.activity a
WHERE a.course_id IS NOT NULL AND a.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

-- A group an activity pointed at that the resolution above missed (a group
-- from a term outside the year, say) still deserves a home.
INSERT INTO course.assignment_group (course_id, name, weight, position)
SELECT DISTINCT ON (a.course_id, lower(gg.name))
  a.course_id, btrim(gg.name), gg.weight, COALESCE(gg.sort_order, 0)
FROM grading.activity a
JOIN grading.grading_group gg ON gg.id = a.grading_group_id
WHERE a.course_id IS NOT NULL AND btrim(COALESCE(gg.name, '')) <> ''
ORDER BY a.course_id, lower(gg.name)
ON CONFLICT DO NOTHING;

UPDATE grading.activity a
SET assignment_group_id = ag.id
FROM grading.grading_group gg, course.assignment_group ag
WHERE a.assignment_group_id IS NULL
  AND gg.id = a.grading_group_id
  AND ag.course_id = a.course_id
  AND lower(ag.name) = lower(btrim(gg.name));

-- Exclusion lived on the assessment; it becomes a flag on the activity.
UPDATE grading.activity a
SET omit_from_final_grade = true
FROM grading.assessment s
WHERE s.id = a.assessment_id AND s.is_excluded AND NOT a.omit_from_final_grade;

-- ── 6. manual assessments become offline activities ─────────────────────────
--
-- An assessment with marks but no activity was entered straight into the old
-- gradebook. It was scoped to (subject, term), not a class, so it becomes one
-- offline activity in each course whose students it marked. assessment_id is
-- kept on the new activity, which is what stops a re-run creating it again.

DROP TABLE IF EXISTS pg_temp.lms_offline_map;
CREATE TEMP TABLE lms_offline_map AS
SELECT pairs.assessment_id, pairs.course_id, gen_random_uuid() AS activity_id
FROM (
  SELECT DISTINCT s.id AS assessment_id, c.id AS course_id
  FROM grading.assessment s
  JOIN public.term t ON t.id = s.term_id
  JOIN grading.grade g ON g.assessment_id = s.id
  JOIN course.course c
    ON c.legacy_subject_id = s.subject_id
   AND c.academic_year_id = t.academic_year_id
  JOIN course.course_student cs
    ON cs.course_id = c.id AND cs.student_id = g.student_id
  WHERE NOT EXISTS (
    SELECT 1 FROM grading.activity a WHERE a.assessment_id = s.id
  )
) pairs;

INSERT INTO grading.activity (
  id, course_id, kind, title, points, due_at, status, published_at,
  assessment_id, assignment_group_id, omit_from_final_grade,
  term_id, subject_id, max_attempts, created_at, updated_at
)
SELECT
  m.activity_id,
  m.course_id,
  'offline'::grading.activity_kind,
  COALESCE(NULLIF(btrim(s.title), ''), 'Assessment'),
  GREATEST(COALESCE(s.max_score, 100), 1),
  s.assessment_date::timestamp with time zone,
  'published'::grading.activity_status,
  now(),
  s.id,
  ag.id,
  COALESCE(s.is_excluded, false),
  s.term_id,
  s.subject_id,
  1,
  now(),
  now()
FROM lms_offline_map m
JOIN grading.assessment s ON s.id = m.assessment_id
LEFT JOIN grading.grading_group gg ON gg.id = s.grading_group_id
LEFT JOIN course.assignment_group ag
  ON ag.course_id = m.course_id
 AND lower(ag.name) = lower(btrim(COALESCE(
       gg.name,
       CASE s.assessment_type WHEN 'exam' THEN 'Exam' ELSE 'Coursework' END
     )));

DROP TABLE lms_offline_map;

-- ── 7. marks become submission scores ───────────────────────────────────────
--
-- grading.grade was the mark the gradebook read; the submission is now. The
-- grade wins where both exist, since a teacher could correct it directly.
-- An offline activity exists once per course, so its marks only go to the
-- copy in the course the student actually sits.

INSERT INTO grading.submission (
  activity_id, student_id, status, score, graded_at, graded_by,
  excused, excused_reason, attempt_count, created_at, updated_at
)
SELECT
  a.id,
  g.student_id,
  'graded'::grading.submission_status,
  g.score,
  COALESCE(g.updated_at, g.created_at, now()),
  COALESCE(g.updated_by, g.created_by),
  COALESCE(g.is_excluded, false),
  g.exclusion_reason,
  0,
  COALESCE(g.created_at, now()),
  now()
FROM grading.grade g
JOIN grading.activity a ON a.assessment_id = g.assessment_id
WHERE a.course_id IS NOT NULL
  AND g.student_id IS NOT NULL
  AND (g.score IS NOT NULL OR g.is_excluded)
  AND (
    a.kind <> 'offline'
    OR EXISTS (
      SELECT 1 FROM course.course_student cs
      WHERE cs.course_id = a.course_id AND cs.student_id = g.student_id
    )
  )
ON CONFLICT (activity_id, student_id) DO UPDATE
SET score = EXCLUDED.score,
    status = 'graded',
    excused = EXCLUDED.excused,
    excused_reason = EXCLUDED.excused_reason,
    graded_at = COALESCE(grading.submission.graded_at, EXCLUDED.graded_at),
    updated_at = now();

-- ── 8. anyone with work in a course is on its roster ────────────────────────
--
-- A student moved out of the class, or outside their recorded subjects, may
-- still have marks here. They join the roster so the marks stay visible:
-- active if still in the class, dropped otherwise.

INSERT INTO course.course_student (course_id, student_id, status)
SELECT DISTINCT
  a.course_id,
  sub.student_id,
  (CASE WHEN EXISTS (
     SELECT 1 FROM student.student_group_enrollment e
     JOIN course.course c ON c.id = a.course_id
     WHERE e.student_id = sub.student_id
       AND e.student_group_id = c.legacy_student_group_id
   ) THEN 'active' ELSE 'dropped' END)::course.course_student_status
FROM grading.submission sub
JOIN grading.activity a ON a.id = sub.activity_id
WHERE a.course_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── report ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_courses   bigint;
  v_orphans   bigint;
  v_lost      bigint;
BEGIN
  SELECT count(*) INTO v_courses FROM course.course WHERE legacy_student_group_id IS NOT NULL;
  SELECT count(*) INTO v_orphans FROM grading.activity WHERE course_id IS NULL;
  SELECT count(*) INTO v_lost
  FROM grading.grade g
  WHERE (g.score IS NOT NULL OR g.is_excluded)
    AND NOT EXISTS (
      SELECT 1
      FROM grading.activity a
      JOIN grading.submission sub
        ON sub.activity_id = a.id AND sub.student_id = g.student_id
      WHERE a.assessment_id = g.assessment_id
    );

  RAISE NOTICE 'lms backfill: % migrated courses, % activities without a course, % marks not carried to a submission',
    v_courses, v_orphans, v_lost;
END;
$$;
