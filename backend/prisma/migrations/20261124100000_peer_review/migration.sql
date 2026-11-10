-- Peer review (src/peer-review), behind the `peer_review` feature (on by
-- default). A teacher turns it on per assignment; when the window opens each
-- student who handed in is given N classmates' submissions to review.

CREATE TABLE grading.peer_review_setting (
    activity_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    reviews_per_student integer DEFAULT 2 NOT NULL,
    anonymous boolean DEFAULT true NOT NULL,
    open_mode text DEFAULT 'after_due'::text NOT NULL,
    closes_at timestamp(6) with time zone NOT NULL,
    rubric_id uuid,
    quality_points numeric,
    quality_activity_id uuid,
    seed text DEFAULT (gen_random_uuid())::text NOT NULL,
    started_at timestamp(6) with time zone,
    ready_notified_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT peer_review_setting_pkey PRIMARY KEY (activity_id),
    CONSTRAINT peer_review_setting_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES grading.activity(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT peer_review_setting_quality_activity_id_fkey FOREIGN KEY (quality_activity_id) REFERENCES grading.activity(id) ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT peer_review_setting_rubric_id_fkey FOREIGN KEY (rubric_id) REFERENCES grading.rubric(id) ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT peer_review_setting_reviews_check CHECK (reviews_per_student BETWEEN 1 AND 10),
    CONSTRAINT peer_review_setting_open_mode_check CHECK (open_mode = ANY (ARRAY['after_due'::text, 'manual'::text])),
    CONSTRAINT peer_review_setting_quality_points_check CHECK (quality_points IS NULL OR (quality_points > 0 AND quality_points <= 1000))
);

CREATE UNIQUE INDEX peer_review_setting_quality_activity_key ON grading.peer_review_setting USING btree (quality_activity_id);
CREATE INDEX idx_peer_review_setting_rubric ON grading.peer_review_setting USING btree (rubric_id);
CREATE INDEX idx_peer_review_setting_closes_at ON grading.peer_review_setting USING btree (closes_at);

CREATE TABLE grading.peer_review_allocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    reviewer_id uuid NOT NULL,
    comment text,
    rubric_marks jsonb DEFAULT '[]'::jsonb NOT NULL,
    submitted_at timestamp(6) with time zone,
    hidden boolean DEFAULT false NOT NULL,
    hidden_reason text,
    hidden_by uuid,
    hidden_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT peer_review_allocation_pkey PRIMARY KEY (id),
    CONSTRAINT peer_review_allocation_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES grading.activity(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT peer_review_allocation_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES grading.submission(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT peer_review_allocation_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES student.student(id) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT peer_review_allocation_marks_array_check CHECK (jsonb_typeof(rubric_marks) = 'array'),
    CONSTRAINT peer_review_allocation_comment_check CHECK (comment IS NULL OR char_length(comment) <= 10000),
    CONSTRAINT peer_review_allocation_hidden_reason_check CHECK (hidden_reason IS NULL OR char_length(hidden_reason) <= 500)
);

CREATE UNIQUE INDEX peer_review_allocation_unique ON grading.peer_review_allocation USING btree (activity_id, reviewer_id, submission_id);
CREATE INDEX idx_peer_review_allocation_reviewer ON grading.peer_review_allocation USING btree (reviewer_id);
CREATE INDEX idx_peer_review_allocation_submission ON grading.peer_review_allocation USING btree (submission_id);

-- A reviewer never reviews their own submission.
CREATE FUNCTION grading.peer_review_allocation_not_self() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM grading.submission s
    WHERE s.id = NEW.submission_id AND s.student_id = NEW.reviewer_id
  ) THEN
    RAISE EXCEPTION 'A student cannot review their own submission' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER peer_review_allocation_not_self
    BEFORE INSERT OR UPDATE OF reviewer_id, submission_id ON grading.peer_review_allocation
    FOR EACH ROW EXECUTE FUNCTION grading.peer_review_allocation_not_self();

-- Course notices: "reviews assigned" and "your reviews are ready", one each
-- per student and activity. The (user, activity) key becomes per kind so a
-- student told about new work can also be told about its reviews.
ALTER TABLE course.course_notification
    DROP CONSTRAINT course_notification_kind_check;

ALTER TABLE course.course_notification
    ADD CONSTRAINT course_notification_kind_check CHECK ((kind = ANY (ARRAY['activity_published'::text, 'announcement'::text, 'discussion_topic'::text, 'discussion_reply'::text, 'peer_review_assigned'::text, 'peer_review_ready'::text])));

ALTER TABLE course.course_notification
    DROP CONSTRAINT course_notification_user_activity_key;
CREATE UNIQUE INDEX course_notification_user_activity_key ON course.course_notification USING btree (user_profile_id, activity_id) WHERE (kind = 'activity_published'::text);
CREATE UNIQUE INDEX course_notification_user_peer_review_assigned_key ON course.course_notification USING btree (user_profile_id, activity_id) WHERE (kind = 'peer_review_assigned'::text);
CREATE UNIQUE INDEX course_notification_user_peer_review_ready_key ON course.course_notification USING btree (user_profile_id, activity_id) WHERE (kind = 'peer_review_ready'::text);
