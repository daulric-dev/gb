-- Course discussions: topics staff (and, when a course allows it, students)
-- start, replies threaded one level deep, and a per-user read marker for
-- unread counts. Staff and students both post as their user_profile.

--
-- Name: discussion_topic; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.discussion_topic (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    author_user_profile_id uuid,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    is_published boolean DEFAULT true NOT NULL,
    require_initial_post boolean DEFAULT false NOT NULL,
    last_reply_at timestamp with time zone,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discussion_topic_title_not_blank CHECK ((btrim(title) <> ''::text))
);


--
-- Name: discussion_reply; Type: TABLE; Schema: course; Owner: -
--

-- A reply with replies of its own is soft-deleted (deleted_at set, body
-- cleared) so the thread under it keeps its place.
CREATE TABLE course.discussion_reply (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic_id uuid NOT NULL,
    course_id uuid NOT NULL,
    parent_id uuid,
    author_user_profile_id uuid,
    body text NOT NULL,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discussion_reply_body_check CHECK (((deleted_at IS NOT NULL) OR (btrim(body) <> ''::text)))
);


--
-- Name: discussion_read; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.discussion_read (
    topic_id uuid NOT NULL,
    user_profile_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: discussion_setting; Type: TABLE; Schema: course; Owner: -
--

-- One row per course that has changed a default; no row means defaults.
CREATE TABLE course.discussion_setting (
    course_id uuid NOT NULL,
    students_can_create_topics boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: discussion_topic discussion_topic_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_topic
    ADD CONSTRAINT discussion_topic_pkey PRIMARY KEY (id);


--
-- Name: discussion_reply discussion_reply_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_reply
    ADD CONSTRAINT discussion_reply_pkey PRIMARY KEY (id);


--
-- Name: discussion_read discussion_read_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_read
    ADD CONSTRAINT discussion_read_pkey PRIMARY KEY (topic_id, user_profile_id);


--
-- Name: discussion_setting discussion_setting_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_setting
    ADD CONSTRAINT discussion_setting_pkey PRIMARY KEY (course_id);


--
-- Name: discussion_topic_course_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX discussion_topic_course_idx ON course.discussion_topic USING btree (course_id, is_pinned DESC, created_at DESC);


--
-- Name: discussion_topic_author_user_profile_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX discussion_topic_author_user_profile_id_idx ON course.discussion_topic USING btree (author_user_profile_id);


--
-- Name: discussion_reply_topic_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX discussion_reply_topic_idx ON course.discussion_reply USING btree (topic_id, created_at);


--
-- Name: discussion_reply_course_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX discussion_reply_course_id_idx ON course.discussion_reply USING btree (course_id);


--
-- Name: discussion_reply_parent_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX discussion_reply_parent_id_idx ON course.discussion_reply USING btree (parent_id);


--
-- Name: discussion_reply_author_user_profile_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX discussion_reply_author_user_profile_id_idx ON course.discussion_reply USING btree (author_user_profile_id);


--
-- Name: discussion_read_user_profile_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX discussion_read_user_profile_id_idx ON course.discussion_read USING btree (user_profile_id);


--
-- Name: discussion_topic discussion_topic_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_topic
    ADD CONSTRAINT discussion_topic_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: discussion_topic discussion_topic_author_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_topic
    ADD CONSTRAINT discussion_topic_author_user_profile_id_fkey FOREIGN KEY (author_user_profile_id) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: discussion_reply discussion_reply_topic_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_reply
    ADD CONSTRAINT discussion_reply_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES course.discussion_topic(id) ON DELETE CASCADE;


--
-- Name: discussion_reply discussion_reply_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_reply
    ADD CONSTRAINT discussion_reply_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: discussion_reply discussion_reply_parent_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_reply
    ADD CONSTRAINT discussion_reply_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES course.discussion_reply(id) ON DELETE CASCADE;


--
-- Name: discussion_reply discussion_reply_author_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_reply
    ADD CONSTRAINT discussion_reply_author_user_profile_id_fkey FOREIGN KEY (author_user_profile_id) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: discussion_read discussion_read_topic_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_read
    ADD CONSTRAINT discussion_read_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES course.discussion_topic(id) ON DELETE CASCADE;


--
-- Name: discussion_read discussion_read_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_read
    ADD CONSTRAINT discussion_read_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: discussion_setting discussion_setting_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.discussion_setting
    ADD CONSTRAINT discussion_setting_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;
