-- In-app notifications for course events (new work published, new
-- announcement), one row per recipient. Push delivery is separate and best
-- effort; this list is what the portal bell and the mobile inbox read.

--
-- Name: course_notification; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.course_notification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_profile_id uuid NOT NULL,
    course_id uuid NOT NULL,
    kind text NOT NULL,
    activity_id uuid,
    announcement_id uuid,
    title text NOT NULL,
    body text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_notification_kind_check CHECK ((kind = ANY (ARRAY['activity_published'::text, 'announcement'::text])))
);


--
-- Name: course_notification course_notification_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_notification
    ADD CONSTRAINT course_notification_pkey PRIMARY KEY (id);


--
-- Name: course_notification course_notification_user_activity_key; Type: CONSTRAINT; Schema: course; Owner: -
--

-- Reopening closed work publishes it again; one notice per student is enough.
ALTER TABLE ONLY course.course_notification
    ADD CONSTRAINT course_notification_user_activity_key UNIQUE (user_profile_id, activity_id);


--
-- Name: course_notification course_notification_user_announcement_key; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_notification
    ADD CONSTRAINT course_notification_user_announcement_key UNIQUE (user_profile_id, announcement_id);


--
-- Name: course_notification_user_created_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_notification_user_created_idx ON course.course_notification USING btree (user_profile_id, created_at DESC);


--
-- Name: course_notification_user_unread_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_notification_user_unread_idx ON course.course_notification USING btree (user_profile_id) WHERE (read_at IS NULL);


--
-- Name: course_notification_course_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_notification_course_id_idx ON course.course_notification USING btree (course_id);


--
-- Name: course_notification course_notification_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_notification
    ADD CONSTRAINT course_notification_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: course_notification course_notification_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_notification
    ADD CONSTRAINT course_notification_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: course_notification course_notification_activity_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_notification
    ADD CONSTRAINT course_notification_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES grading.activity(id) ON DELETE CASCADE;


--
-- Name: course_notification course_notification_announcement_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_notification
    ADD CONSTRAINT course_notification_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(id) ON DELETE CASCADE;
