-- Record when grades for an activity are published to students, and prevent duplicate notifications.
ALTER TABLE grading.activity ADD COLUMN IF NOT EXISTS grades_published_at TIMESTAMPTZ(6);
CREATE UNIQUE INDEX IF NOT EXISTS course_notification_user_grades_published_key ON course.course_notification (user_profile_id, activity_id) WHERE (kind = 'grades_published');
