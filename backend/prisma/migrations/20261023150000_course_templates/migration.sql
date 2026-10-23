-- Course templates: a course flagged as a template is a starting point the
-- school copies new courses from. It never takes students, so it never shows
-- in a student's views; copying one makes an ordinary draft course.

--
-- Name: course is_template; Type: COLUMN; Schema: course; Owner: -
--

ALTER TABLE course.course
    ADD COLUMN is_template boolean DEFAULT false NOT NULL;


--
-- Name: course_school_template_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_school_template_idx ON course.course USING btree (school_id) WHERE is_template;
