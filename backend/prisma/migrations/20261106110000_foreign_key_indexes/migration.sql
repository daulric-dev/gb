-- Indexes on foreign keys that had none, so a cascading delete of the parent
-- (or a lookup by it) does not scan the child table.
--
-- course.course_notification  activity_id, announcement_id (the unique keys
--                             lead with user_profile_id, so they do not help)
-- chat.message                sender_id
-- file_manager.notification   file_id
-- file_manager.file           folder_id (idx_file_owner_folder leads with owner_id)
-- file_manager.folder         parent_id (idx_folder_owner_parent leads with owner_id)
-- grading.quiz_answer         question_id (idx_quiz_answer_one_per_question
--                             leads with submission_id), option_id

CREATE INDEX course_notification_activity_id_idx ON course.course_notification USING btree (activity_id);

CREATE INDEX course_notification_announcement_id_idx ON course.course_notification USING btree (announcement_id);

CREATE INDEX idx_message_sender ON chat.message USING btree (sender_id);

CREATE INDEX idx_file_notification_file ON file_manager.notification USING btree (file_id);

CREATE INDEX idx_file_folder ON file_manager.file USING btree (folder_id);

CREATE INDEX idx_folder_parent ON file_manager.folder USING btree (parent_id);

CREATE INDEX idx_quiz_answer_question ON grading.quiz_answer USING btree (question_id);

CREATE INDEX idx_quiz_answer_option ON grading.quiz_answer USING btree (option_id);
