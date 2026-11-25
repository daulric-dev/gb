-- Record when grades for an activity are published to students, and prevent duplicate notifications.
ALTER TABLE grading.activity ADD COLUMN IF NOT EXISTS grades_published_at TIMESTAMPTZ(6);
CREATE UNIQUE INDEX IF NOT EXISTS course_notification_user_grades_published_key ON course.course_notification (user_profile_id, activity_id) WHERE (kind = 'grades_published');
ALTER TABLE course.course_notification DROP CONSTRAINT IF EXISTS course_notification_kind_check;
ALTER TABLE course.course_notification ADD CONSTRAINT course_notification_kind_check CHECK (kind = ANY (ARRAY['activity_published'::text, 'announcement'::text, 'discussion_topic'::text, 'discussion_reply'::text, 'peer_review_assigned'::text, 'peer_review_ready'::text, 'grades_published'::text]));
