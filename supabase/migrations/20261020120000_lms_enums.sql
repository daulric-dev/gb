-- Enum values the course-based LMS needs, in a migration of their own.
--
-- Postgres refuses to use an enum value in the same transaction that added
-- it, and the backfill that follows writes both of these. Keeping the
-- additions here means each later migration sees them already committed.

-- Graded work with no online submission: a paper test, a practical, or a
-- legacy manual assessment carried over from the class/subject gradebook.
ALTER TYPE "grading"."activity_kind" ADD VALUE IF NOT EXISTS 'offline';

-- Share a file with everyone in a course, replacing the class ("group") share.
ALTER TYPE "file_manager"."share_principal" ADD VALUE IF NOT EXISTS 'course';
