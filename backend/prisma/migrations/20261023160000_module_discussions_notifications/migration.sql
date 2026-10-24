-- Discussion topics as module items, and notices about discussions.
--
-- A module item can now point at a discussion topic of its course; the item
-- goes when the topic does. Course notices gain two kinds - a topic was
-- published, someone replied - and a pointer at the topic they are about.
--
-- The new enum value is added here but never cast to in this migration (it
-- runs in one transaction, and a value added in a transaction cannot be used
-- until it commits), so the item-type check compares item_type as text.

--
-- Name: module_item_type discussion; Type: TYPE VALUE; Schema: course; Owner: -
--

ALTER TYPE course.module_item_type ADD VALUE IF NOT EXISTS 'discussion';


--
-- Name: module_item discussion_topic_id; Type: COLUMN; Schema: course; Owner: -
--

ALTER TABLE course.module_item
    ADD COLUMN discussion_topic_id uuid;


--
-- Name: module_item module_item_target_matches_type; Type: CHECK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE course.module_item
    DROP CONSTRAINT module_item_target_matches_type;

ALTER TABLE course.module_item
    ADD CONSTRAINT module_item_target_matches_type CHECK (
CASE (item_type)::text
    WHEN 'page'::text THEN (page_id IS NOT NULL)
    WHEN 'activity'::text THEN (activity_id IS NOT NULL)
    WHEN 'file'::text THEN (file_id IS NOT NULL)
    WHEN 'link'::text THEN ((url IS NOT NULL) AND (title IS NOT NULL))
    WHEN 'header'::text THEN (title IS NOT NULL)
    WHEN 'discussion'::text THEN (discussion_topic_id IS NOT NULL)
    ELSE NULL::boolean
END);


--
-- Name: module_item_discussion_topic_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX module_item_discussion_topic_id_idx ON course.module_item USING btree (discussion_topic_id);


--
-- Name: module_item module_item_discussion_topic_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.module_item
    ADD CONSTRAINT module_item_discussion_topic_id_fkey FOREIGN KEY (discussion_topic_id) REFERENCES course.discussion_topic(id) ON DELETE CASCADE;


--
-- Name: course_notification discussion_topic_id; Type: COLUMN; Schema: course; Owner: -
--

ALTER TABLE course.course_notification
    ADD COLUMN discussion_topic_id uuid;


--
-- Name: course_notification course_notification_kind_check; Type: CHECK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE course.course_notification
    DROP CONSTRAINT course_notification_kind_check;

ALTER TABLE course.course_notification
    ADD CONSTRAINT course_notification_kind_check CHECK ((kind = ANY (ARRAY['activity_published'::text, 'announcement'::text, 'discussion_topic'::text, 'discussion_reply'::text])));


--
-- Name: course_notification_discussion_topic_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_notification_discussion_topic_id_idx ON course.course_notification USING btree (discussion_topic_id);


--
-- Name: course_notification_user_topic_published_key; Type: INDEX; Schema: course; Owner: -
--

-- Unpublishing and republishing a topic tells each student once.
CREATE UNIQUE INDEX course_notification_user_topic_published_key ON course.course_notification USING btree (user_profile_id, discussion_topic_id) WHERE (kind = 'discussion_topic'::text);


--
-- Name: course_notification_user_topic_unread_reply_key; Type: INDEX; Schema: course; Owner: -
--

-- Replies coalesce: at most one unread reply notice per person and topic,
-- refreshed as more replies come in.
CREATE UNIQUE INDEX course_notification_user_topic_unread_reply_key ON course.course_notification USING btree (user_profile_id, discussion_topic_id) WHERE ((kind = 'discussion_reply'::text) AND (read_at IS NULL));


--
-- Name: course_notification course_notification_discussion_topic_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_notification
    ADD CONSTRAINT course_notification_discussion_topic_id_fkey FOREIGN KEY (discussion_topic_id) REFERENCES course.discussion_topic(id) ON DELETE CASCADE;
