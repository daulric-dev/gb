-- Late-work policy. An activity can accept work after its due date until
-- late_until, with a penalty of late_penalty_value percent per started day
-- or hour late (at most late_penalty_cap percent, and never more than 100).
-- A student's own extension replaces both dates: they close at it and are
-- never late before it.
CREATE TYPE grading.late_penalty_mode AS ENUM ('none', 'percent_per_day', 'percent_per_hour');

ALTER TABLE grading.activity
  ADD COLUMN late_until timestamp(6) with time zone,
  ADD COLUMN late_penalty_mode grading.late_penalty_mode NOT NULL DEFAULT 'none',
  ADD COLUMN late_penalty_value numeric(5,2),
  ADD COLUMN late_penalty_cap numeric(5,2),
  ADD CONSTRAINT activity_late_until_after_due_check
    CHECK (late_until IS NULL OR (due_at IS NOT NULL AND late_until > due_at)),
  ADD CONSTRAINT activity_late_penalty_check
    CHECK (
      (late_penalty_mode = 'none' AND late_penalty_value IS NULL AND late_penalty_cap IS NULL)
      OR (late_penalty_mode <> 'none' AND late_until IS NOT NULL
          AND late_penalty_value > 0 AND late_penalty_value <= 100
          AND (late_penalty_cap IS NULL OR (late_penalty_cap > 0 AND late_penalty_cap <= 100)))
    );

-- The mark is still submission.score, now after any late penalty, so the
-- gradebook, CSV export, report cards and portals read one number.
-- raw_score is the mark before the penalty (null when no penalty logic
-- applies, e.g. imported marks); late_seconds is how late the work was handed
-- in (quizzes: how late the attempt was started); late_penalty_percent is the
-- penalty the policy gives that lateness (applied unless waived).
ALTER TABLE grading.submission
  ADD COLUMN raw_score numeric,
  ADD COLUMN attempt_started_at timestamp(6) with time zone,
  ADD COLUMN late_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN late_penalty_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN late_penalty_waived boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT submission_late_seconds_check CHECK (late_seconds >= 0),
  ADD CONSTRAINT submission_late_penalty_percent_check
    CHECK (late_penalty_percent >= 0 AND late_penalty_percent <= 100);
