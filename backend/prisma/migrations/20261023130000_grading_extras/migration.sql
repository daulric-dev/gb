-- Grading extras: rubrics for marking, and drop-lowest / drop-highest rules
-- on assignment groups. The submission stays the one place a mark lives; a
-- rubric assessment records how that mark was reached.

--
-- Name: assignment_group drop rules; Type: COLUMN; Schema: course; Owner: -
--

ALTER TABLE course.assignment_group
    ADD COLUMN drop_lowest integer DEFAULT 0 NOT NULL,
    ADD COLUMN drop_highest integer DEFAULT 0 NOT NULL,
    ADD CONSTRAINT assignment_group_drop_lowest_range CHECK (((drop_lowest >= 0) AND (drop_lowest <= 50))),
    ADD CONSTRAINT assignment_group_drop_highest_range CHECK (((drop_highest >= 0) AND (drop_highest <= 50)));


--
-- Name: rubric; Type: TABLE; Schema: grading; Owner: -
--

-- Rubrics belong to a course and are reused across its activities.
CREATE TABLE grading.rubric (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rubric_title_not_blank CHECK ((btrim(title) <> ''::text))
);


--
-- Name: rubric_criterion; Type: TABLE; Schema: grading; Owner: -
--

CREATE TABLE grading.rubric_criterion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rubric_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    points numeric NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT rubric_criterion_points_check CHECK ((points >= (0)::numeric))
);


--
-- Name: rubric_rating; Type: TABLE; Schema: grading; Owner: -
--

CREATE TABLE grading.rubric_rating (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    criterion_id uuid NOT NULL,
    label text NOT NULL,
    description text,
    points numeric NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT rubric_rating_points_check CHECK ((points >= (0)::numeric))
);


--
-- Name: rubric_assessment; Type: TABLE; Schema: grading; Owner: -
--

-- One row per (submission, criterion): the level picked and the points it
-- gave. points is kept so the record survives a level being reworded.
CREATE TABLE grading.rubric_assessment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    criterion_id uuid NOT NULL,
    rating_id uuid,
    points numeric NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rubric_assessment_points_check CHECK ((points >= (0)::numeric))
);


--
-- Name: activity rubric_id; Type: COLUMN; Schema: grading; Owner: -
--

ALTER TABLE grading.activity
    ADD COLUMN rubric_id uuid;


--
-- Name: rubric rubric_pkey; Type: CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.rubric
    ADD CONSTRAINT rubric_pkey PRIMARY KEY (id);

ALTER TABLE ONLY grading.rubric_criterion
    ADD CONSTRAINT rubric_criterion_pkey PRIMARY KEY (id);

ALTER TABLE ONLY grading.rubric_rating
    ADD CONSTRAINT rubric_rating_pkey PRIMARY KEY (id);

ALTER TABLE ONLY grading.rubric_assessment
    ADD CONSTRAINT rubric_assessment_pkey PRIMARY KEY (id);

ALTER TABLE ONLY grading.rubric_assessment
    ADD CONSTRAINT rubric_assessment_submission_criterion_key UNIQUE (submission_id, criterion_id);


--
-- Indexes
--

CREATE INDEX idx_rubric_course ON grading.rubric USING btree (course_id);

CREATE INDEX idx_rubric_criterion_rubric ON grading.rubric_criterion USING btree (rubric_id, "position");

CREATE INDEX idx_rubric_rating_criterion ON grading.rubric_rating USING btree (criterion_id, "position");

CREATE INDEX idx_rubric_assessment_criterion ON grading.rubric_assessment USING btree (criterion_id);

CREATE INDEX idx_activity_rubric ON grading.activity USING btree (rubric_id);


--
-- Foreign keys
--

ALTER TABLE ONLY grading.rubric
    ADD CONSTRAINT rubric_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;

ALTER TABLE ONLY grading.rubric
    ADD CONSTRAINT rubric_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;

ALTER TABLE ONLY grading.rubric_criterion
    ADD CONSTRAINT rubric_criterion_rubric_id_fkey FOREIGN KEY (rubric_id) REFERENCES grading.rubric(id) ON DELETE CASCADE;

ALTER TABLE ONLY grading.rubric_rating
    ADD CONSTRAINT rubric_rating_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES grading.rubric_criterion(id) ON DELETE CASCADE;

ALTER TABLE ONLY grading.rubric_assessment
    ADD CONSTRAINT rubric_assessment_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES grading.submission(id) ON DELETE CASCADE;

ALTER TABLE ONLY grading.rubric_assessment
    ADD CONSTRAINT rubric_assessment_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES grading.rubric_criterion(id) ON DELETE CASCADE;

ALTER TABLE ONLY grading.rubric_assessment
    ADD CONSTRAINT rubric_assessment_rating_id_fkey FOREIGN KEY (rating_id) REFERENCES grading.rubric_rating(id) ON DELETE SET NULL;

-- Deleting a rubric detaches it; the activity and its marks stay.
ALTER TABLE ONLY grading.activity
    ADD CONSTRAINT activity_rubric_id_fkey FOREIGN KEY (rubric_id) REFERENCES grading.rubric(id) ON DELETE SET NULL;
