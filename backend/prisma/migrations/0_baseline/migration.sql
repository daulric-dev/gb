-- Baseline: the whole GradeBook schema. Generated from the schema with
-- pg_dump once the app moved to its own Postgres; later changes are ordinary
-- Prisma migrations in this folder.

CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";
SET check_function_bodies = false;

--
-- Name: account; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS account;


--
-- Name: chat; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS chat;


--
-- Name: course; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS course;


--
-- Name: file_manager; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS file_manager;


--
-- Name: grading; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS grading;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: student; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS student;


--
-- Name: conversation_type; Type: TYPE; Schema: chat; Owner: -
--

CREATE TYPE chat.conversation_type AS ENUM (
    'direct',
    'channel'
);


--
-- Name: message_action_state; Type: TYPE; Schema: chat; Owner: -
--

CREATE TYPE chat.message_action_state AS ENUM (
    'pending',
    'accepted',
    'dismissed'
);


--
-- Name: message_type; Type: TYPE; Schema: chat; Owner: -
--

CREATE TYPE chat.message_type AS ENUM (
    'text',
    'file_share',
    'class_invite',
    'system'
);


--
-- Name: attendance_method; Type: TYPE; Schema: course; Owner: -
--

CREATE TYPE course.attendance_method AS ENUM (
    'self',
    'teacher',
    'auto',
    'qr'
);


--
-- Name: attendance_status; Type: TYPE; Schema: course; Owner: -
--

CREATE TYPE course.attendance_status AS ENUM (
    'present',
    'late',
    'absent',
    'excused'
);


--
-- Name: course_staff_role; Type: TYPE; Schema: course; Owner: -
--

CREATE TYPE course.course_staff_role AS ENUM (
    'teacher',
    'ta'
);


--
-- Name: course_status; Type: TYPE; Schema: course; Owner: -
--

CREATE TYPE course.course_status AS ENUM (
    'draft',
    'published',
    'archived'
);


--
-- Name: course_student_status; Type: TYPE; Schema: course; Owner: -
--

CREATE TYPE course.course_student_status AS ENUM (
    'active',
    'dropped',
    'completed'
);


--
-- Name: module_item_type; Type: TYPE; Schema: course; Owner: -
--

CREATE TYPE course.module_item_type AS ENUM (
    'page',
    'activity',
    'file',
    'link',
    'header'
);


--
-- Name: file_source; Type: TYPE; Schema: file_manager; Owner: -
--

CREATE TYPE file_manager.file_source AS ENUM (
    'report',
    'upload'
);


--
-- Name: file_status; Type: TYPE; Schema: file_manager; Owner: -
--

CREATE TYPE file_manager.file_status AS ENUM (
    'pending',
    'scanning',
    'ready',
    'failed',
    'infected'
);


--
-- Name: share_principal; Type: TYPE; Schema: file_manager; Owner: -
--

CREATE TYPE file_manager.share_principal AS ENUM (
    'user',
    'role',
    'group',
    'course'
);


--
-- Name: activity_kind; Type: TYPE; Schema: grading; Owner: -
--

CREATE TYPE grading.activity_kind AS ENUM (
    'quiz',
    'assignment',
    'offline'
);


--
-- Name: activity_status; Type: TYPE; Schema: grading; Owner: -
--

CREATE TYPE grading.activity_status AS ENUM (
    'draft',
    'published',
    'closed'
);


--
-- Name: question_kind; Type: TYPE; Schema: grading; Owner: -
--

CREATE TYPE grading.question_kind AS ENUM (
    'multiple_choice',
    'true_false',
    'short_answer'
);


--
-- Name: submission_status; Type: TYPE; Schema: grading; Owner: -
--

CREATE TYPE grading.submission_status AS ENUM (
    'draft',
    'submitted',
    'graded'
);


--
-- Name: account_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_type AS ENUM (
    'staff',
    'student'
);


--
-- Name: attendance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attendance_status AS ENUM (
    'present',
    'absent',
    'late'
);


--
-- Name: email_domain_audience; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_domain_audience AS ENUM (
    'student',
    'staff',
    'any'
);


--
-- Name: gender; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gender AS ENUM (
    'male',
    'female'
);


--
-- Name: grade_scale_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grade_scale_type AS ENUM (
    'letter',
    'gpa',
    'pass_fail'
);


--
-- Name: join_request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.join_request_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: relationship_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.relationship_type AS ENUM (
    'mother',
    'father',
    'guardian'
);


--
-- Name: role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role AS ENUM (
    'admin',
    'teacher',
    'member'
);


--
-- Name: schooltype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.schooltype AS ENUM (
    'primary',
    'secondary'
);


--
-- Name: unread_counts(uuid); Type: FUNCTION; Schema: chat; Owner: -
--

CREATE FUNCTION chat.unread_counts(p_user_id uuid) RETURNS TABLE(conversation_id uuid, unread bigint)
    LANGUAGE sql STABLE
    AS $$
  SELECT cm.conversation_id, COUNT(m.id) AS unread
  FROM chat.conversation_member cm
  LEFT JOIN chat.message m
    ON m.conversation_id = cm.conversation_id
    AND m.sender_id <> p_user_id
    AND m.deleted_at IS NULL
    AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
  WHERE cm.user_id = p_user_id
  GROUP BY cm.conversation_id;
$$;


--
-- Name: submit_quiz(uuid, uuid); Type: FUNCTION; Schema: grading; Owner: -
--

CREATE FUNCTION grading.submit_quiz(p_submission_id uuid, p_student_id uuid) RETURNS TABLE(score numeric, points numeric, attempts_used integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'grading', 'public'
    AS $$
DECLARE
  v_sub      record;
  v_activity record;
  v_earned   numeric := 0;
  v_possible numeric := 0;
  v_scaled   numeric;
  v_attempts integer;
BEGIN
  SELECT s.id, s.activity_id, s.student_id, s.status, s.attempt_count
  INTO v_sub
  FROM grading.submission s WHERE s.id = p_submission_id FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'submission_not_found' USING ERRCODE = 'P0020';
  END IF;

  -- The caller passes the student the guard resolved, never one from a client.
  IF v_sub.student_id <> p_student_id THEN
    RAISE EXCEPTION 'submission_not_yours' USING ERRCODE = 'P0021';
  END IF;

  SELECT a.id, a.kind, a.points, a.status, a.max_attempts
  INTO v_activity
  FROM grading.activity a WHERE a.id = v_sub.activity_id;

  IF v_activity.kind <> 'quiz' THEN
    RAISE EXCEPTION 'not_a_quiz' USING ERRCODE = 'P0023';
  END IF;

  IF v_activity.status <> 'published' THEN
    RAISE EXCEPTION 'activity_not_open' USING ERRCODE = 'P0024';
  END IF;

  -- NULL max_attempts is unlimited; otherwise this attempt must fit.
  IF v_activity.max_attempts IS NOT NULL
     AND v_sub.attempt_count >= v_activity.max_attempts THEN
    RAISE EXCEPTION 'no_attempts_left' USING ERRCODE = 'P0022';
  END IF;

  v_attempts := v_sub.attempt_count + 1;

  SELECT
    COALESCE(SUM(q.points), 0),
    COALESCE(SUM(CASE WHEN correct.hit THEN q.points ELSE 0 END), 0)
  INTO v_possible, v_earned
  FROM grading.quiz_question q
  LEFT JOIN grading.quiz_answer ans
    ON ans.question_id = q.id AND ans.submission_id = p_submission_id
  LEFT JOIN LATERAL (
    SELECT CASE
      WHEN q.kind = 'short_answer' THEN EXISTS (
        SELECT 1
        FROM grading.quiz_option o
        WHERE o.question_id = q.id
          AND o.is_correct
          AND ans.text_answer IS NOT NULL
          AND lower(btrim(ans.text_answer)) = lower(btrim(o.label))
      )
      -- The option must belong to this question: a correct option id from
      -- some other question is not a right answer here.
      ELSE EXISTS (
        SELECT 1
        FROM grading.quiz_option o
        WHERE o.id = ans.option_id AND o.question_id = q.id AND o.is_correct
      )
    END AS hit
  ) correct ON true
  WHERE q.activity_id = v_activity.id;

  -- Scale to the activity's points so the gradebook is in its own units.
  v_scaled := CASE
    WHEN v_possible > 0 THEN (v_earned / v_possible) * v_activity.points
    ELSE 0
  END;

  UPDATE grading.submission s
  SET status = 'graded',
      submitted_at = now(),
      graded_at = now(),
      score = v_scaled,
      attempt_count = v_attempts,
      updated_at = now()
  WHERE s.id = p_submission_id;

  RETURN QUERY SELECT v_scaled, v_activity.points, v_attempts;
END;
$$;


--
-- Name: join_school_by_email_domain(uuid, uuid, public.email_domain_audience, public.role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_school_by_email_domain(p_user_id uuid, p_school_id uuid, p_audience public.email_domain_audience, p_staff_role public.role) RETURNS TABLE(student_id uuid, school_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'student'
    AS $$
DECLARE
  v_profile    record;
  v_student_id uuid;
BEGIN
  SELECT up.id, up.first_name, up.last_name, up.school_id, up.account_type
  INTO v_profile
  FROM public.user_profile up
  WHERE up.id = p_user_id
  FOR UPDATE;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0004';
  END IF;

  IF v_profile.school_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_in_a_school' USING ERRCODE = 'P0012';
  END IF;

  IF p_audience = 'student' THEN
    INSERT INTO student.student (
      school_id, first_name, last_name, user_profile_id, is_active
    )
    VALUES (
      p_school_id, v_profile.first_name, v_profile.last_name, p_user_id, true
    )
    RETURNING id INTO v_student_id;

    UPDATE public.user_profile up
    SET school_id = p_school_id,
        account_type = 'student',
        role = NULL,
        is_active = true
    WHERE up.id = p_user_id;
  ELSE
    IF p_staff_role = 'admin' THEN
      RAISE EXCEPTION 'admin_not_allowed' USING ERRCODE = 'P0013';
    END IF;

    INSERT INTO public.school_management (user_id, school_id, role)
    VALUES (p_user_id, p_school_id, p_staff_role)
    ON CONFLICT (user_id, school_id) DO NOTHING;

    UPDATE public.user_profile up
    SET school_id = p_school_id,
        account_type = 'staff',
        role = p_staff_role,
        is_active = true
    WHERE up.id = p_user_id;
  END IF;

  RETURN QUERY SELECT v_student_id, p_school_id;
END;
$$;


--
-- Name: merge_student_records(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_student_records(p_admin_id uuid, p_joined_id uuid, p_existing_id uuid) RETURNS TABLE(student_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'student'
    AS $$
DECLARE
  v_admin_school uuid;
  v_joined       record;
  v_existing     record;
BEGIN
  SELECT up.school_id INTO v_admin_school
  FROM public.user_profile up
  WHERE up.id = p_admin_id;

  IF v_admin_school IS NULL THEN
    RAISE EXCEPTION 'admin_without_school' USING ERRCODE = 'P0005';
  END IF;

  SELECT s.id, s.school_id, s.user_profile_id INTO v_joined
  FROM student.student s WHERE s.id = p_joined_id FOR UPDATE;

  SELECT s.id, s.school_id, s.user_profile_id INTO v_existing
  FROM student.student s WHERE s.id = p_existing_id FOR UPDATE;

  IF v_joined.id IS NULL OR v_existing.id IS NULL THEN
    RAISE EXCEPTION 'student_not_found' USING ERRCODE = 'P0013';
  END IF;

  IF v_joined.school_id <> v_admin_school
     OR v_existing.school_id <> v_admin_school THEN
    RAISE EXCEPTION 'student_other_school' USING ERRCODE = 'P0014';
  END IF;

  IF v_joined.user_profile_id IS NULL THEN
    RAISE EXCEPTION 'joined_record_has_no_account' USING ERRCODE = 'P0015';
  END IF;

  IF v_existing.user_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'existing_record_already_claimed' USING ERRCODE = 'P0016';
  END IF;

  -- Refuse to discard anything that carries results. The join-time record is
  -- expected to be empty; if it is not, this is not the duplicate we think.
  IF EXISTS (SELECT 1 FROM grading.submission s WHERE s.student_id = p_joined_id)
     OR EXISTS (SELECT 1 FROM course.attendance_record a WHERE a.student_id = p_joined_id)
     OR EXISTS (SELECT 1 FROM course.course_student c WHERE c.student_id = p_joined_id)
  THEN
    RAISE EXCEPTION 'joined_record_has_data' USING ERRCODE = 'P0017';
  END IF;

  -- Free the unique index before re-pointing the login.
  UPDATE student.student s
  SET user_profile_id = NULL
  WHERE s.id = p_joined_id;

  UPDATE student.student s
  SET user_profile_id = v_joined.user_profile_id
  WHERE s.id = p_existing_id;

  DELETE FROM student.student s WHERE s.id = p_joined_id;

  RETURN QUERY SELECT p_existing_id;
END;
$$;


--
-- Name: redeem_school_join_code(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redeem_school_join_code(p_user_id uuid, p_code_hash text) RETURNS TABLE(student_id uuid, school_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'student'
    AS $$
DECLARE
  v_school_id  uuid;
  v_profile    record;
  v_student_id uuid;
BEGIN
  -- Aliased: bare column names would be ambiguous against the RETURNS TABLE
  -- columns of the same name.
  SELECT sjc.school_id INTO v_school_id
  FROM student.school_join_code sjc
  WHERE sjc.code_hash = p_code_hash
    AND sjc.revoked_at IS NULL
    AND sjc.expires_at > now();

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'invalid_join_code' USING ERRCODE = 'P0011';
  END IF;

  SELECT up.id, up.first_name, up.last_name, up.school_id
  INTO v_profile
  FROM public.user_profile up
  WHERE up.id = p_user_id;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0004';
  END IF;

  -- Already settled somewhere; joining again would orphan the first record.
  IF v_profile.school_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_in_a_school' USING ERRCODE = 'P0012';
  END IF;

  INSERT INTO student.student (
    school_id, first_name, last_name, user_profile_id, is_active
  )
  VALUES (
    v_school_id,
    v_profile.first_name,
    v_profile.last_name,
    p_user_id,
    true
  )
  RETURNING id INTO v_student_id;

  -- No school_management row: students are not staff members.
  UPDATE public.user_profile up
  SET school_id = v_school_id,
      account_type = 'student',
      role = NULL,
      is_active = true
  WHERE up.id = p_user_id;

  RETURN QUERY SELECT v_student_id, v_school_id;
END;
$$;


--
-- Name: seed_school_system_roles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_school_system_roles() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
  INSERT INTO public.school_role (school_id, name, is_system)
  SELECT NEW.id, r.name, true
  FROM (VALUES ('admin'), ('teacher'), ('member')) AS r(name)
  ON CONFLICT (school_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: student_duplicate_candidates(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_duplicate_candidates(p_school_id uuid) RETURNS TABLE(joined_id uuid, existing_id uuid, full_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'student'
    AS $$
  SELECT
    joined.id   AS joined_id,
    existing.id AS existing_id,
    btrim(coalesce(joined.first_name, '') || ' ' || coalesce(joined.last_name, ''))
      AS full_name
  FROM student.student joined
  JOIN student.student existing
    ON existing.school_id = joined.school_id
   AND existing.id <> joined.id
   AND existing.user_profile_id IS NULL
   AND lower(btrim(coalesce(existing.first_name, '') || ' ' ||
                   coalesce(existing.last_name, '')))
     = lower(btrim(coalesce(joined.first_name, '') || ' ' ||
                   coalesce(joined.last_name, '')))
  WHERE joined.school_id = p_school_id
    AND joined.user_profile_id IS NOT NULL
    -- Only the freshly created side is worth merging away: a joined record
    -- that already carries results is not a duplicate, it is in use.
    AND NOT EXISTS (SELECT 1 FROM grading.submission s WHERE s.student_id = joined.id)
    AND NOT EXISTS (SELECT 1 FROM course.attendance_record a WHERE a.student_id = joined.id)
    AND NOT EXISTS (SELECT 1 FROM course.course_student c WHERE c.student_id = joined.id)
  ORDER BY full_name;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_user; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.app_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    email_verified_at timestamp with time zone,
    disabled_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_user_email_lower CHECK ((email = lower(email)))
);


--
-- Name: email_code; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.email_code (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_code_email_lower CHECK ((email = lower(email)))
);


--
-- Name: identity; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.identity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    subject text NOT NULL,
    email text,
    claims jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: account; Owner: -
--

CREATE TABLE account.session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    user_agent text,
    ip text,
    method text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.conversation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    type chat.conversation_type DEFAULT 'direct'::chat.conversation_type NOT NULL,
    title text,
    direct_key text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    last_message_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text)
);


--
-- Name: conversation_member; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.conversation_member (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    last_read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text)
);


--
-- Name: message; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    school_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    type chat.message_type DEFAULT 'text'::chat.message_type NOT NULL,
    body text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    action_state chat.message_action_state,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- Name: assignment_group; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.assignment_group (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    name text NOT NULL,
    weight numeric(5,2),
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assignment_group_name_not_blank CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT assignment_group_weight_range CHECK (((weight IS NULL) OR ((weight >= (0)::numeric) AND (weight <= (100)::numeric))))
);


--
-- Name: attendance_record; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.attendance_record (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    course_id uuid NOT NULL,
    student_id uuid NOT NULL,
    status course.attendance_status NOT NULL,
    method course.attendance_method NOT NULL,
    checked_in_at timestamp with time zone,
    distance_m integer,
    note text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attendance_session; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.attendance_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title text,
    opened_by uuid,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    check_in_code text,
    late_after_minutes integer,
    latitude double precision,
    longitude double precision,
    radius_m integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    qr_secret text,
    CONSTRAINT attendance_session_code_format CHECK (((check_in_code IS NULL) OR (check_in_code ~ '^[0-9]{4}$'::text))),
    CONSTRAINT attendance_session_late_positive CHECK (((late_after_minutes IS NULL) OR (late_after_minutes >= 0))),
    CONSTRAINT attendance_session_location_complete CHECK ((((latitude IS NULL) AND (longitude IS NULL) AND (radius_m IS NULL)) OR ((latitude IS NOT NULL) AND (longitude IS NOT NULL) AND ((radius_m >= 10) AND (radius_m <= 5000))))),
    CONSTRAINT attendance_session_window CHECK ((closes_at > opened_at))
);


--
-- Name: course; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.course (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    academic_year_id uuid,
    term_id uuid,
    name text NOT NULL,
    code text,
    description text,
    status course.course_status DEFAULT 'draft'::course.course_status NOT NULL,
    join_code text,
    grade_scale_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_name_not_blank CHECK ((btrim(name) <> ''::text))
);


--
-- Name: course_staff; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.course_staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    user_profile_id uuid NOT NULL,
    role course.course_staff_role DEFAULT 'teacher'::course.course_staff_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: course_student; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.course_student (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    student_id uuid NOT NULL,
    status course.course_student_status DEFAULT 'active'::course.course_student_status NOT NULL,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: module; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.module (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT module_title_not_blank CHECK ((btrim(title) <> ''::text))
);


--
-- Name: module_item; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.module_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_id uuid NOT NULL,
    course_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    item_type course.module_item_type NOT NULL,
    title text,
    page_id uuid,
    activity_id uuid,
    file_id uuid,
    url text,
    indent smallint DEFAULT 0 NOT NULL,
    is_published boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT module_item_indent_range CHECK (((indent >= 0) AND (indent <= 3))),
    CONSTRAINT module_item_target_matches_type CHECK (
CASE item_type
    WHEN 'page'::course.module_item_type THEN (page_id IS NOT NULL)
    WHEN 'activity'::course.module_item_type THEN (activity_id IS NOT NULL)
    WHEN 'file'::course.module_item_type THEN (file_id IS NOT NULL)
    WHEN 'link'::course.module_item_type THEN ((url IS NOT NULL) AND (title IS NOT NULL))
    WHEN 'header'::course.module_item_type THEN (title IS NOT NULL)
    ELSE NULL::boolean
END)
);


--
-- Name: page; Type: TABLE; Schema: course; Owner: -
--

CREATE TABLE course.page (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT page_title_not_blank CHECK ((btrim(title) <> ''::text))
);


--
-- Name: file; Type: TABLE; Schema: file_manager; Owner: -
--

CREATE TABLE file_manager.file (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    bucket text DEFAULT 'file-manager'::text NOT NULL,
    storage_path text NOT NULL,
    content_type text DEFAULT 'application/octet-stream'::text NOT NULL,
    size_bytes bigint DEFAULT 0 NOT NULL,
    source file_manager.file_source DEFAULT 'upload'::file_manager.file_source NOT NULL,
    source_ref uuid,
    status file_manager.file_status DEFAULT 'pending'::file_manager.file_status NOT NULL,
    scan_detail text,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    deleted_at timestamp with time zone,
    folder_id uuid
);


--
-- Name: file_share; Type: TABLE; Schema: file_manager; Owner: -
--

CREATE TABLE file_manager.file_share (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    file_id uuid NOT NULL,
    school_id uuid NOT NULL,
    principal_type file_manager.share_principal NOT NULL,
    principal_id uuid NOT NULL,
    can_download boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text)
);


--
-- Name: folder; Type: TABLE; Schema: file_manager; Owner: -
--

CREATE TABLE file_manager.folder (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    deleted_at timestamp with time zone
);


--
-- Name: notification; Type: TABLE; Schema: file_manager; Owner: -
--

CREATE TABLE file_manager.notification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    user_id uuid NOT NULL,
    file_id uuid,
    share_id uuid,
    type text DEFAULT 'file_share'::text NOT NULL,
    title text NOT NULL,
    body text,
    can_download boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text)
);


--
-- Name: activity; Type: TABLE; Schema: grading; Owner: -
--

CREATE TABLE grading.activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind grading.activity_kind NOT NULL,
    title text NOT NULL,
    instructions text,
    points numeric DEFAULT 100 NOT NULL,
    due_at timestamp with time zone,
    status grading.activity_status DEFAULT 'draft'::grading.activity_status NOT NULL,
    published_at timestamp with time zone,
    allow_file boolean DEFAULT false NOT NULL,
    allow_text boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    max_attempts integer DEFAULT 1,
    course_id uuid NOT NULL,
    assignment_group_id uuid,
    omit_from_final_grade boolean DEFAULT false NOT NULL,
    CONSTRAINT activity_assignment_accepts_something CHECK (((kind <> 'assignment'::grading.activity_kind) OR allow_file OR allow_text)),
    CONSTRAINT activity_max_attempts_positive CHECK (((max_attempts IS NULL) OR (max_attempts >= 1))),
    CONSTRAINT activity_points_positive CHECK ((points > (0)::numeric))
);


--
-- Name: grade_scale; Type: TABLE; Schema: grading; Owner: -
--

CREATE TABLE grading.grade_scale (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    scale_type public.grade_scale_type NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text)
);


--
-- Name: grade_scale_band; Type: TABLE; Schema: grading; Owner: -
--

CREATE TABLE grading.grade_scale_band (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    grade_scale_id uuid NOT NULL,
    label text NOT NULL,
    min_percentage numeric(5,2) NOT NULL,
    max_percentage numeric(5,2) NOT NULL,
    gpa_points numeric(4,2),
    is_pass boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    CONSTRAINT grade_scale_band_range_valid CHECK (((min_percentage >= (0)::numeric) AND (max_percentage <= (100)::numeric) AND (min_percentage <= max_percentage)))
);


--
-- Name: quiz_answer; Type: TABLE; Schema: grading; Owner: -
--

CREATE TABLE grading.quiz_answer (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    question_id uuid NOT NULL,
    option_id uuid,
    text_answer text
);


--
-- Name: quiz_option; Type: TABLE; Schema: grading; Owner: -
--

CREATE TABLE grading.quiz_option (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question_id uuid NOT NULL,
    label text NOT NULL,
    is_correct boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: quiz_question; Type: TABLE; Schema: grading; Owner: -
--

CREATE TABLE grading.quiz_question (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    prompt text NOT NULL,
    kind grading.question_kind NOT NULL,
    points numeric DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    CONSTRAINT quiz_question_points_positive CHECK ((points > (0)::numeric))
);


--
-- Name: submission; Type: TABLE; Schema: grading; Owner: -
--

CREATE TABLE grading.submission (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    student_id uuid NOT NULL,
    status grading.submission_status DEFAULT 'draft'::grading.submission_status NOT NULL,
    text_body text,
    file_id uuid,
    submitted_at timestamp with time zone,
    score numeric,
    feedback text,
    graded_at timestamp with time zone,
    graded_by uuid,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    excused boolean DEFAULT false NOT NULL,
    excused_reason text
);


--
-- Name: academic_year; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_year (
    school_id uuid,
    name text,
    start_date date,
    end_date date,
    is_active boolean DEFAULT true,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: announcement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    author_user_profile_id uuid,
    title text NOT NULL,
    body text,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    course_id uuid
);


--
-- Name: announcement_read; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_read (
    announcement_id uuid NOT NULL,
    user_profile_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text)
);


--
-- Name: permission_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource text NOT NULL,
    action text NOT NULL,
    key text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT permission_catalog_action_check CHECK ((action = ANY (ARRAY['create'::text, 'read'::text, 'update'::text, 'delete'::text])))
);


--
-- Name: push_device; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_device (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_device_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])))
);


--
-- Name: school; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    code text,
    school_type public.schooltype,
    address text,
    phone text,
    email text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    owner_id uuid
);


--
-- Name: school_email_domain; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_email_domain (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    domain text NOT NULL,
    audience public.email_domain_audience NOT NULL,
    auto_join boolean DEFAULT true NOT NULL,
    staff_role public.role DEFAULT 'teacher'::public.role NOT NULL,
    verification_token text NOT NULL,
    verified_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sso_provider text,
    sso_required boolean DEFAULT false NOT NULL,
    azure_tenant_id text,
    saml_entry_point text,
    saml_issuer text,
    saml_certificate text,
    CONSTRAINT school_email_domain_azure_tenant_format CHECK (((azure_tenant_id IS NULL) OR (azure_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text))),
    CONSTRAINT school_email_domain_format CHECK (((domain = lower(domain)) AND (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'::text))),
    CONSTRAINT school_email_domain_sso_provider_format CHECK (((sso_provider IS NULL) OR (sso_provider ~ '^[a-z][a-z0-9_-]{1,31}$'::text))),
    CONSTRAINT school_email_domain_sso_required_needs_provider CHECK (((NOT sso_required) OR (sso_provider IS NOT NULL))),
    CONSTRAINT school_email_domain_staff_role CHECK ((staff_role <> 'admin'::public.role))
);


--
-- Name: school_join_request; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_join_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    school_id uuid NOT NULL,
    status public.join_request_status DEFAULT 'pending'::public.join_request_status NOT NULL,
    message text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid
);


--
-- Name: school_management; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_management (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    school_id uuid NOT NULL,
    role public.role,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: school_management_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_management_role (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_management_id uuid NOT NULL,
    school_role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: school_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_role (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: school_role_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_role_permission (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: term; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.term (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    academic_year_id uuid,
    start_date date,
    end_date date,
    sort_order smallint,
    CONSTRAINT term_name_not_blank CHECK (((name IS NULL) OR (btrim(name) <> ''::text)))
);


--
-- Name: user_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profile (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid,
    first_name text,
    last_name text,
    role public.role,
    avatar_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text),
    email text,
    account_type public.account_type DEFAULT 'staff'::public.account_type NOT NULL
);


--
-- Name: parent_student_link; Type: TABLE; Schema: student; Owner: -
--

CREATE TABLE student.parent_student_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_profile_id uuid,
    student_id uuid,
    relationship public.relationship_type
);


--
-- Name: school_join_code; Type: TABLE; Schema: student; Owner: -
--

CREATE TABLE student.school_join_code (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);


--
-- Name: student; Type: TABLE; Schema: student; Owner: -
--

CREATE TABLE student.student (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid,
    first_name text,
    last_name text,
    date_of_birth date,
    gender text,
    enrollment_date date,
    is_active boolean DEFAULT true,
    user_profile_id uuid
);


--
-- Name: app_user app_user_email_key; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.app_user
    ADD CONSTRAINT app_user_email_key UNIQUE (email);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);


--
-- Name: email_code email_code_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.email_code
    ADD CONSTRAINT email_code_pkey PRIMARY KEY (id);


--
-- Name: identity identity_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.identity
    ADD CONSTRAINT identity_pkey PRIMARY KEY (id);


--
-- Name: identity identity_provider_subject_key; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.identity
    ADD CONSTRAINT identity_provider_subject_key UNIQUE (provider, subject);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_hash_key; Type: CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.session
    ADD CONSTRAINT session_token_hash_key UNIQUE (token_hash);


--
-- Name: conversation_member conversation_member_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.conversation_member
    ADD CONSTRAINT conversation_member_pkey PRIMARY KEY (id);


--
-- Name: conversation_member conversation_member_unique; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.conversation_member
    ADD CONSTRAINT conversation_member_unique UNIQUE (conversation_id, user_id);


--
-- Name: conversation conversation_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.conversation
    ADD CONSTRAINT conversation_pkey PRIMARY KEY (id);


--
-- Name: message message_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message
    ADD CONSTRAINT message_pkey PRIMARY KEY (id);


--
-- Name: assignment_group assignment_group_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.assignment_group
    ADD CONSTRAINT assignment_group_pkey PRIMARY KEY (id);


--
-- Name: attendance_record attendance_record_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.attendance_record
    ADD CONSTRAINT attendance_record_pkey PRIMARY KEY (id);


--
-- Name: attendance_record attendance_record_session_student_key; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.attendance_record
    ADD CONSTRAINT attendance_record_session_student_key UNIQUE (session_id, student_id);


--
-- Name: attendance_session attendance_session_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.attendance_session
    ADD CONSTRAINT attendance_session_pkey PRIMARY KEY (id);


--
-- Name: course course_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course
    ADD CONSTRAINT course_pkey PRIMARY KEY (id);


--
-- Name: course_staff course_staff_course_user_key; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_staff
    ADD CONSTRAINT course_staff_course_user_key UNIQUE (course_id, user_profile_id);


--
-- Name: course_staff course_staff_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_staff
    ADD CONSTRAINT course_staff_pkey PRIMARY KEY (id);


--
-- Name: course_student course_student_course_student_key; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_student
    ADD CONSTRAINT course_student_course_student_key UNIQUE (course_id, student_id);


--
-- Name: course_student course_student_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_student
    ADD CONSTRAINT course_student_pkey PRIMARY KEY (id);


--
-- Name: module_item module_item_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.module_item
    ADD CONSTRAINT module_item_pkey PRIMARY KEY (id);


--
-- Name: module module_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.module
    ADD CONSTRAINT module_pkey PRIMARY KEY (id);


--
-- Name: page page_pkey; Type: CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.page
    ADD CONSTRAINT page_pkey PRIMARY KEY (id);


--
-- Name: notification file_notification_pkey; Type: CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.notification
    ADD CONSTRAINT file_notification_pkey PRIMARY KEY (id);


--
-- Name: notification file_notification_unique_recipient_share; Type: CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.notification
    ADD CONSTRAINT file_notification_unique_recipient_share UNIQUE (user_id, share_id);


--
-- Name: file file_pkey; Type: CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.file
    ADD CONSTRAINT file_pkey PRIMARY KEY (id);


--
-- Name: file_share file_share_pkey; Type: CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.file_share
    ADD CONSTRAINT file_share_pkey PRIMARY KEY (id);


--
-- Name: file_share file_share_unique_principal; Type: CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.file_share
    ADD CONSTRAINT file_share_unique_principal UNIQUE (file_id, principal_type, principal_id);


--
-- Name: folder folder_pkey; Type: CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.folder
    ADD CONSTRAINT folder_pkey PRIMARY KEY (id);


--
-- Name: activity activity_pkey; Type: CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.activity
    ADD CONSTRAINT activity_pkey PRIMARY KEY (id);


--
-- Name: grade_scale_band grade_scale_band_pkey; Type: CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.grade_scale_band
    ADD CONSTRAINT grade_scale_band_pkey PRIMARY KEY (id);


--
-- Name: grade_scale_band grade_scale_band_scale_label_unique; Type: CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.grade_scale_band
    ADD CONSTRAINT grade_scale_band_scale_label_unique UNIQUE (grade_scale_id, label);


--
-- Name: grade_scale grade_scale_pkey; Type: CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.grade_scale
    ADD CONSTRAINT grade_scale_pkey PRIMARY KEY (id);


--
-- Name: quiz_answer quiz_answer_pkey; Type: CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.quiz_answer
    ADD CONSTRAINT quiz_answer_pkey PRIMARY KEY (id);


--
-- Name: quiz_option quiz_option_pkey; Type: CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.quiz_option
    ADD CONSTRAINT quiz_option_pkey PRIMARY KEY (id);


--
-- Name: quiz_question quiz_question_pkey; Type: CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.quiz_question
    ADD CONSTRAINT quiz_question_pkey PRIMARY KEY (id);


--
-- Name: submission submission_pkey; Type: CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.submission
    ADD CONSTRAINT submission_pkey PRIMARY KEY (id);


--
-- Name: academic_year academic_year_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_year
    ADD CONSTRAINT academic_year_pkey PRIMARY KEY (id);


--
-- Name: announcement announcement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement
    ADD CONSTRAINT announcement_pkey PRIMARY KEY (id);


--
-- Name: announcement_read announcement_read_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_read
    ADD CONSTRAINT announcement_read_pkey PRIMARY KEY (announcement_id, user_profile_id);


--
-- Name: permission_catalog permission_catalog_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_catalog
    ADD CONSTRAINT permission_catalog_key_unique UNIQUE (key);


--
-- Name: permission_catalog permission_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_catalog
    ADD CONSTRAINT permission_catalog_pkey PRIMARY KEY (id);


--
-- Name: permission_catalog permission_catalog_resource_action_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_catalog
    ADD CONSTRAINT permission_catalog_resource_action_unique UNIQUE (resource, action);


--
-- Name: push_device push_device_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_device
    ADD CONSTRAINT push_device_pkey PRIMARY KEY (id);


--
-- Name: push_device push_device_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_device
    ADD CONSTRAINT push_device_token_key UNIQUE (token);


--
-- Name: school_email_domain school_email_domain_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_email_domain
    ADD CONSTRAINT school_email_domain_pkey PRIMARY KEY (id);


--
-- Name: school_email_domain school_email_domain_school_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_email_domain
    ADD CONSTRAINT school_email_domain_school_domain_key UNIQUE (school_id, domain);


--
-- Name: school_join_request school_join_request_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_join_request
    ADD CONSTRAINT school_join_request_pkey PRIMARY KEY (id);


--
-- Name: school_management school_management_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_management
    ADD CONSTRAINT school_management_pkey PRIMARY KEY (id);


--
-- Name: school_management_role school_management_role_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_management_role
    ADD CONSTRAINT school_management_role_pkey PRIMARY KEY (id);


--
-- Name: school_management_role school_management_role_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_management_role
    ADD CONSTRAINT school_management_role_unique UNIQUE (school_management_id, school_role_id);


--
-- Name: school_management school_management_user_school_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_management
    ADD CONSTRAINT school_management_user_school_unique UNIQUE (user_id, school_id);


--
-- Name: school school_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school
    ADD CONSTRAINT school_pkey PRIMARY KEY (id);


--
-- Name: school_role_permission school_role_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_role_permission
    ADD CONSTRAINT school_role_permission_pkey PRIMARY KEY (id);


--
-- Name: school_role_permission school_role_permission_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_role_permission
    ADD CONSTRAINT school_role_permission_unique UNIQUE (school_role_id, permission_id);


--
-- Name: school_role school_role_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_role
    ADD CONSTRAINT school_role_pkey PRIMARY KEY (id);


--
-- Name: school_role school_role_school_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_role
    ADD CONSTRAINT school_role_school_name_unique UNIQUE (school_id, name);


--
-- Name: term term_academic_year_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.term
    ADD CONSTRAINT term_academic_year_id_name_unique UNIQUE (academic_year_id, name);


--
-- Name: term term_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.term
    ADD CONSTRAINT term_pkey PRIMARY KEY (id);


--
-- Name: user_profile user_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profile
    ADD CONSTRAINT user_profile_pkey PRIMARY KEY (id);


--
-- Name: parent_student_link parent_student_link_pkey; Type: CONSTRAINT; Schema: student; Owner: -
--

ALTER TABLE ONLY student.parent_student_link
    ADD CONSTRAINT parent_student_link_pkey PRIMARY KEY (id);


--
-- Name: school_join_code school_join_code_pkey; Type: CONSTRAINT; Schema: student; Owner: -
--

ALTER TABLE ONLY student.school_join_code
    ADD CONSTRAINT school_join_code_pkey PRIMARY KEY (id);


--
-- Name: student student_pkey; Type: CONSTRAINT; Schema: student; Owner: -
--

ALTER TABLE ONLY student.student
    ADD CONSTRAINT student_pkey PRIMARY KEY (id);


--
-- Name: email_code_email_idx; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX email_code_email_idx ON account.email_code USING btree (email, created_at DESC);


--
-- Name: identity_user_id_idx; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX identity_user_id_idx ON account.identity USING btree (user_id);


--
-- Name: session_expires_at_idx; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX session_expires_at_idx ON account.session USING btree (expires_at);


--
-- Name: session_user_id_idx; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX session_user_id_idx ON account.session USING btree (user_id);


--
-- Name: idx_conversation_direct_key; Type: INDEX; Schema: chat; Owner: -
--

CREATE UNIQUE INDEX idx_conversation_direct_key ON chat.conversation USING btree (school_id, direct_key) WHERE ((type = 'direct'::chat.conversation_type) AND (direct_key IS NOT NULL));


--
-- Name: idx_conversation_member_conversation; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_conversation_member_conversation ON chat.conversation_member USING btree (conversation_id);


--
-- Name: idx_conversation_member_user; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_conversation_member_user ON chat.conversation_member USING btree (user_id);


--
-- Name: idx_conversation_school; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_conversation_school ON chat.conversation USING btree (school_id, last_message_at DESC);


--
-- Name: idx_message_conversation; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_message_conversation ON chat.message USING btree (conversation_id, created_at DESC);


--
-- Name: assignment_group_course_name_key; Type: INDEX; Schema: course; Owner: -
--

CREATE UNIQUE INDEX assignment_group_course_name_key ON course.assignment_group USING btree (course_id, lower(name));


--
-- Name: attendance_record_course_student_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX attendance_record_course_student_idx ON course.attendance_record USING btree (course_id, student_id);


--
-- Name: attendance_record_student_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX attendance_record_student_id_idx ON course.attendance_record USING btree (student_id);


--
-- Name: attendance_record_updated_by_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX attendance_record_updated_by_idx ON course.attendance_record USING btree (updated_by);


--
-- Name: attendance_session_course_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX attendance_session_course_id_idx ON course.attendance_session USING btree (course_id, opened_at DESC);


--
-- Name: attendance_session_one_open_per_course; Type: INDEX; Schema: course; Owner: -
--

CREATE UNIQUE INDEX attendance_session_one_open_per_course ON course.attendance_session USING btree (course_id) WHERE (closed_at IS NULL);


--
-- Name: attendance_session_open_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX attendance_session_open_idx ON course.attendance_session USING btree (closes_at) WHERE (closed_at IS NULL);


--
-- Name: attendance_session_opened_by_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX attendance_session_opened_by_idx ON course.attendance_session USING btree (opened_by);


--
-- Name: course_academic_year_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_academic_year_id_idx ON course.course USING btree (academic_year_id);


--
-- Name: course_created_by_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_created_by_idx ON course.course USING btree (created_by);


--
-- Name: course_grade_scale_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_grade_scale_id_idx ON course.course USING btree (grade_scale_id);


--
-- Name: course_join_code_key; Type: INDEX; Schema: course; Owner: -
--

CREATE UNIQUE INDEX course_join_code_key ON course.course USING btree (upper(join_code)) WHERE (join_code IS NOT NULL);


--
-- Name: course_school_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_school_id_idx ON course.course USING btree (school_id);


--
-- Name: course_staff_user_profile_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_staff_user_profile_id_idx ON course.course_staff USING btree (user_profile_id);


--
-- Name: course_student_student_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_student_student_id_idx ON course.course_student USING btree (student_id);


--
-- Name: course_term_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX course_term_id_idx ON course.course USING btree (term_id);


--
-- Name: module_course_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX module_course_id_idx ON course.module USING btree (course_id);


--
-- Name: module_item_activity_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX module_item_activity_id_idx ON course.module_item USING btree (activity_id);


--
-- Name: module_item_course_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX module_item_course_id_idx ON course.module_item USING btree (course_id);


--
-- Name: module_item_file_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX module_item_file_id_idx ON course.module_item USING btree (file_id);


--
-- Name: module_item_module_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX module_item_module_id_idx ON course.module_item USING btree (module_id);


--
-- Name: module_item_page_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX module_item_page_id_idx ON course.module_item USING btree (page_id);


--
-- Name: page_course_id_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX page_course_id_idx ON course.page USING btree (course_id);


--
-- Name: page_created_by_idx; Type: INDEX; Schema: course; Owner: -
--

CREATE INDEX page_created_by_idx ON course.page USING btree (created_by);


--
-- Name: idx_file_notification_unread; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE INDEX idx_file_notification_unread ON file_manager.notification USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: idx_file_notification_user; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE INDEX idx_file_notification_user ON file_manager.notification USING btree (user_id, created_at DESC);


--
-- Name: idx_file_owner_active; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE INDEX idx_file_owner_active ON file_manager.file USING btree (owner_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_file_owner_folder; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE INDEX idx_file_owner_folder ON file_manager.file USING btree (owner_id, folder_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_file_school; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE INDEX idx_file_school ON file_manager.file USING btree (school_id);


--
-- Name: idx_file_share_file; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE INDEX idx_file_share_file ON file_manager.file_share USING btree (file_id);


--
-- Name: idx_file_share_principal; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE INDEX idx_file_share_principal ON file_manager.file_share USING btree (principal_type, principal_id);


--
-- Name: idx_folder_owner_parent; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE INDEX idx_folder_owner_parent ON file_manager.folder USING btree (owner_id, parent_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_folder_unique_child; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE UNIQUE INDEX idx_folder_unique_child ON file_manager.folder USING btree (owner_id, parent_id, name) WHERE ((parent_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_folder_unique_root; Type: INDEX; Schema: file_manager; Owner: -
--

CREATE UNIQUE INDEX idx_folder_unique_root ON file_manager.folder USING btree (owner_id, name) WHERE ((parent_id IS NULL) AND (deleted_at IS NULL));


--
-- Name: activity_assignment_group_id_idx; Type: INDEX; Schema: grading; Owner: -
--

CREATE INDEX activity_assignment_group_id_idx ON grading.activity USING btree (assignment_group_id);


--
-- Name: activity_course_id_idx; Type: INDEX; Schema: grading; Owner: -
--

CREATE INDEX activity_course_id_idx ON grading.activity USING btree (course_id);


--
-- Name: grade_scale_one_default_per_school; Type: INDEX; Schema: grading; Owner: -
--

CREATE UNIQUE INDEX grade_scale_one_default_per_school ON grading.grade_scale USING btree (school_id) WHERE (is_default = true);


--
-- Name: idx_activity_status; Type: INDEX; Schema: grading; Owner: -
--

CREATE INDEX idx_activity_status ON grading.activity USING btree (status);


--
-- Name: idx_grade_scale_band_scale; Type: INDEX; Schema: grading; Owner: -
--

CREATE INDEX idx_grade_scale_band_scale ON grading.grade_scale_band USING btree (grade_scale_id, sort_order);


--
-- Name: idx_grade_scale_school; Type: INDEX; Schema: grading; Owner: -
--

CREATE INDEX idx_grade_scale_school ON grading.grade_scale USING btree (school_id);


--
-- Name: idx_quiz_answer_one_per_question; Type: INDEX; Schema: grading; Owner: -
--

CREATE UNIQUE INDEX idx_quiz_answer_one_per_question ON grading.quiz_answer USING btree (submission_id, question_id);


--
-- Name: idx_quiz_option_question; Type: INDEX; Schema: grading; Owner: -
--

CREATE INDEX idx_quiz_option_question ON grading.quiz_option USING btree (question_id);


--
-- Name: idx_quiz_question_activity; Type: INDEX; Schema: grading; Owner: -
--

CREATE INDEX idx_quiz_question_activity ON grading.quiz_question USING btree (activity_id);


--
-- Name: idx_submission_one_per_student; Type: INDEX; Schema: grading; Owner: -
--

CREATE UNIQUE INDEX idx_submission_one_per_student ON grading.submission USING btree (activity_id, student_id);


--
-- Name: idx_submission_student; Type: INDEX; Schema: grading; Owner: -
--

CREATE INDEX idx_submission_student ON grading.submission USING btree (student_id);


--
-- Name: announcement_course_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcement_course_id_idx ON public.announcement USING btree (course_id);


--
-- Name: idx_academic_year_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_academic_year_school ON public.academic_year USING btree (school_id);


--
-- Name: idx_announcement_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcement_author ON public.announcement USING btree (author_user_profile_id);


--
-- Name: idx_announcement_read_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcement_read_user ON public.announcement_read USING btree (user_profile_id);


--
-- Name: idx_announcement_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcement_school ON public.announcement USING btree (school_id);


--
-- Name: idx_announcement_school_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcement_school_created ON public.announcement USING btree (school_id, created_at DESC);


--
-- Name: idx_school_join_request_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_school_join_request_school ON public.school_join_request USING btree (school_id);


--
-- Name: idx_school_management_role_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_school_management_role_role ON public.school_management_role USING btree (school_role_id);


--
-- Name: idx_school_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_school_owner ON public.school USING btree (owner_id);


--
-- Name: idx_school_role_permission_permission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_school_role_permission_permission ON public.school_role_permission USING btree (permission_id);


--
-- Name: idx_term_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_term_year ON public.term USING btree (academic_year_id);


--
-- Name: idx_user_profile_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_profile_school ON public.user_profile USING btree (school_id);


--
-- Name: push_device_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_device_user_id_idx ON public.push_device USING btree (user_id);


--
-- Name: school_email_domain_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_email_domain_created_by_idx ON public.school_email_domain USING btree (created_by);


--
-- Name: school_email_domain_verified_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX school_email_domain_verified_key ON public.school_email_domain USING btree (domain) WHERE (verified_at IS NOT NULL);


--
-- Name: school_join_request_pending_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX school_join_request_pending_unique ON public.school_join_request USING btree (user_id, school_id) WHERE (status = 'pending'::public.join_request_status);


--
-- Name: school_management_one_admin_per_school; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX school_management_one_admin_per_school ON public.school_management USING btree (school_id) WHERE (role = 'admin'::public.role);


--
-- Name: school_management_role_management_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_management_role_management_idx ON public.school_management_role USING btree (school_management_id);


--
-- Name: school_management_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_management_user_id_idx ON public.school_management USING btree (user_id);


--
-- Name: school_role_permission_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_role_permission_role_idx ON public.school_role_permission USING btree (school_role_id);


--
-- Name: school_role_school_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_role_school_id_idx ON public.school_role USING btree (school_id);


--
-- Name: idx_parent_link_student; Type: INDEX; Schema: student; Owner: -
--

CREATE INDEX idx_parent_link_student ON student.parent_student_link USING btree (student_id);


--
-- Name: idx_parent_link_user_profile; Type: INDEX; Schema: student; Owner: -
--

CREATE INDEX idx_parent_link_user_profile ON student.parent_student_link USING btree (user_profile_id);


--
-- Name: idx_school_join_code_hash; Type: INDEX; Schema: student; Owner: -
--

CREATE INDEX idx_school_join_code_hash ON student.school_join_code USING btree (code_hash);


--
-- Name: idx_school_join_code_one_active; Type: INDEX; Schema: student; Owner: -
--

CREATE UNIQUE INDEX idx_school_join_code_one_active ON student.school_join_code USING btree (school_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_student_first_name_trgm; Type: INDEX; Schema: student; Owner: -
--

CREATE INDEX idx_student_first_name_trgm ON student.student USING gin (first_name extensions.gin_trgm_ops);


--
-- Name: idx_student_last_name_trgm; Type: INDEX; Schema: student; Owner: -
--

CREATE INDEX idx_student_last_name_trgm ON student.student USING gin (last_name extensions.gin_trgm_ops);


--
-- Name: idx_student_school; Type: INDEX; Schema: student; Owner: -
--

CREATE INDEX idx_student_school ON student.student USING btree (school_id);


--
-- Name: idx_student_user_profile_unique; Type: INDEX; Schema: student; Owner: -
--

CREATE UNIQUE INDEX idx_student_user_profile_unique ON student.student USING btree (user_profile_id) WHERE (user_profile_id IS NOT NULL);


--
-- Name: school seed_school_system_roles_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER seed_school_system_roles_trigger AFTER INSERT ON public.school FOR EACH ROW EXECUTE FUNCTION public.seed_school_system_roles();


--
-- Name: identity identity_user_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.identity
    ADD CONSTRAINT identity_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.app_user(id) ON DELETE CASCADE;


--
-- Name: session session_user_id_fkey; Type: FK CONSTRAINT; Schema: account; Owner: -
--

ALTER TABLE ONLY account.session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.app_user(id) ON DELETE CASCADE;


--
-- Name: conversation conversation_created_by_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.conversation
    ADD CONSTRAINT conversation_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: conversation_member conversation_member_conversation_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.conversation_member
    ADD CONSTRAINT conversation_member_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat.conversation(id) ON DELETE CASCADE;


--
-- Name: conversation_member conversation_member_user_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.conversation_member
    ADD CONSTRAINT conversation_member_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: conversation conversation_school_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.conversation
    ADD CONSTRAINT conversation_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: message message_conversation_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message
    ADD CONSTRAINT message_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat.conversation(id) ON DELETE CASCADE;


--
-- Name: message message_school_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message
    ADD CONSTRAINT message_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: message message_sender_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message
    ADD CONSTRAINT message_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: assignment_group assignment_group_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.assignment_group
    ADD CONSTRAINT assignment_group_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: attendance_record attendance_record_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.attendance_record
    ADD CONSTRAINT attendance_record_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: attendance_record attendance_record_session_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.attendance_record
    ADD CONSTRAINT attendance_record_session_id_fkey FOREIGN KEY (session_id) REFERENCES course.attendance_session(id) ON DELETE CASCADE;


--
-- Name: attendance_record attendance_record_student_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.attendance_record
    ADD CONSTRAINT attendance_record_student_id_fkey FOREIGN KEY (student_id) REFERENCES student.student(id) ON DELETE CASCADE;


--
-- Name: attendance_record attendance_record_updated_by_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.attendance_record
    ADD CONSTRAINT attendance_record_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: attendance_session attendance_session_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.attendance_session
    ADD CONSTRAINT attendance_session_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: attendance_session attendance_session_opened_by_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.attendance_session
    ADD CONSTRAINT attendance_session_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: course course_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course
    ADD CONSTRAINT course_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_year(id) ON DELETE SET NULL;


--
-- Name: course course_created_by_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course
    ADD CONSTRAINT course_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: course course_grade_scale_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course
    ADD CONSTRAINT course_grade_scale_id_fkey FOREIGN KEY (grade_scale_id) REFERENCES grading.grade_scale(id) ON DELETE SET NULL;


--
-- Name: course course_school_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course
    ADD CONSTRAINT course_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: course_staff course_staff_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_staff
    ADD CONSTRAINT course_staff_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: course_staff course_staff_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_staff
    ADD CONSTRAINT course_staff_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: course_student course_student_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_student
    ADD CONSTRAINT course_student_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: course_student course_student_student_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course_student
    ADD CONSTRAINT course_student_student_id_fkey FOREIGN KEY (student_id) REFERENCES student.student(id) ON DELETE CASCADE;


--
-- Name: course course_term_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.course
    ADD CONSTRAINT course_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.term(id) ON DELETE SET NULL;


--
-- Name: module module_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.module
    ADD CONSTRAINT module_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: module_item module_item_activity_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.module_item
    ADD CONSTRAINT module_item_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES grading.activity(id) ON DELETE CASCADE;


--
-- Name: module_item module_item_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.module_item
    ADD CONSTRAINT module_item_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: module_item module_item_file_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.module_item
    ADD CONSTRAINT module_item_file_id_fkey FOREIGN KEY (file_id) REFERENCES file_manager.file(id) ON DELETE CASCADE;


--
-- Name: module_item module_item_module_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.module_item
    ADD CONSTRAINT module_item_module_id_fkey FOREIGN KEY (module_id) REFERENCES course.module(id) ON DELETE CASCADE;


--
-- Name: module_item module_item_page_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.module_item
    ADD CONSTRAINT module_item_page_id_fkey FOREIGN KEY (page_id) REFERENCES course.page(id) ON DELETE CASCADE;


--
-- Name: page page_course_id_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.page
    ADD CONSTRAINT page_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: page page_created_by_fkey; Type: FK CONSTRAINT; Schema: course; Owner: -
--

ALTER TABLE ONLY course.page
    ADD CONSTRAINT page_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: file file_folder_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.file
    ADD CONSTRAINT file_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES file_manager.folder(id) ON DELETE SET NULL;


--
-- Name: notification file_notification_file_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.notification
    ADD CONSTRAINT file_notification_file_id_fkey FOREIGN KEY (file_id) REFERENCES file_manager.file(id) ON DELETE CASCADE;


--
-- Name: notification file_notification_school_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.notification
    ADD CONSTRAINT file_notification_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: notification file_notification_user_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.notification
    ADD CONSTRAINT file_notification_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: file file_owner_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.file
    ADD CONSTRAINT file_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: file file_school_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.file
    ADD CONSTRAINT file_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: file_share file_share_created_by_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.file_share
    ADD CONSTRAINT file_share_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: file_share file_share_file_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.file_share
    ADD CONSTRAINT file_share_file_id_fkey FOREIGN KEY (file_id) REFERENCES file_manager.file(id) ON DELETE CASCADE;


--
-- Name: file_share file_share_school_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.file_share
    ADD CONSTRAINT file_share_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: folder folder_owner_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.folder
    ADD CONSTRAINT folder_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: folder folder_parent_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.folder
    ADD CONSTRAINT folder_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES file_manager.folder(id) ON DELETE CASCADE;


--
-- Name: folder folder_school_id_fkey; Type: FK CONSTRAINT; Schema: file_manager; Owner: -
--

ALTER TABLE ONLY file_manager.folder
    ADD CONSTRAINT folder_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: activity activity_assignment_group_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.activity
    ADD CONSTRAINT activity_assignment_group_id_fkey FOREIGN KEY (assignment_group_id) REFERENCES course.assignment_group(id) ON DELETE SET NULL;


--
-- Name: activity activity_course_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.activity
    ADD CONSTRAINT activity_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: activity activity_created_by_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.activity
    ADD CONSTRAINT activity_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: grade_scale_band grade_scale_band_scale_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.grade_scale_band
    ADD CONSTRAINT grade_scale_band_scale_fkey FOREIGN KEY (grade_scale_id) REFERENCES grading.grade_scale(id) ON DELETE CASCADE;


--
-- Name: grade_scale grade_scale_created_by_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.grade_scale
    ADD CONSTRAINT grade_scale_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: grade_scale grade_scale_school_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.grade_scale
    ADD CONSTRAINT grade_scale_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: grade_scale grade_scale_updated_by_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.grade_scale
    ADD CONSTRAINT grade_scale_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: quiz_answer quiz_answer_option_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.quiz_answer
    ADD CONSTRAINT quiz_answer_option_id_fkey FOREIGN KEY (option_id) REFERENCES grading.quiz_option(id) ON DELETE SET NULL;


--
-- Name: quiz_answer quiz_answer_question_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.quiz_answer
    ADD CONSTRAINT quiz_answer_question_id_fkey FOREIGN KEY (question_id) REFERENCES grading.quiz_question(id) ON DELETE CASCADE;


--
-- Name: quiz_answer quiz_answer_submission_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.quiz_answer
    ADD CONSTRAINT quiz_answer_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES grading.submission(id) ON DELETE CASCADE;


--
-- Name: quiz_option quiz_option_question_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.quiz_option
    ADD CONSTRAINT quiz_option_question_id_fkey FOREIGN KEY (question_id) REFERENCES grading.quiz_question(id) ON DELETE CASCADE;


--
-- Name: quiz_question quiz_question_activity_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.quiz_question
    ADD CONSTRAINT quiz_question_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES grading.activity(id) ON DELETE CASCADE;


--
-- Name: submission submission_activity_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.submission
    ADD CONSTRAINT submission_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES grading.activity(id) ON DELETE CASCADE;


--
-- Name: submission submission_file_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.submission
    ADD CONSTRAINT submission_file_id_fkey FOREIGN KEY (file_id) REFERENCES file_manager.file(id) ON DELETE SET NULL;


--
-- Name: submission submission_graded_by_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.submission
    ADD CONSTRAINT submission_graded_by_fkey FOREIGN KEY (graded_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: submission submission_student_id_fkey; Type: FK CONSTRAINT; Schema: grading; Owner: -
--

ALTER TABLE ONLY grading.submission
    ADD CONSTRAINT submission_student_id_fkey FOREIGN KEY (student_id) REFERENCES student.student(id) ON DELETE CASCADE;


--
-- Name: academic_year academic_year_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_year
    ADD CONSTRAINT academic_year_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: announcement announcement_author_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement
    ADD CONSTRAINT announcement_author_user_profile_id_fkey FOREIGN KEY (author_user_profile_id) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: announcement announcement_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement
    ADD CONSTRAINT announcement_course_id_fkey FOREIGN KEY (course_id) REFERENCES course.course(id) ON DELETE CASCADE;


--
-- Name: announcement_read announcement_read_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_read
    ADD CONSTRAINT announcement_read_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcement(id) ON DELETE CASCADE;


--
-- Name: announcement_read announcement_read_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_read
    ADD CONSTRAINT announcement_read_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: announcement announcement_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement
    ADD CONSTRAINT announcement_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: push_device push_device_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_device
    ADD CONSTRAINT push_device_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: school_email_domain school_email_domain_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_email_domain
    ADD CONSTRAINT school_email_domain_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: school_email_domain school_email_domain_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_email_domain
    ADD CONSTRAINT school_email_domain_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: school_join_request school_join_request_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_join_request
    ADD CONSTRAINT school_join_request_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: school_join_request school_join_request_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_join_request
    ADD CONSTRAINT school_join_request_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: school_join_request school_join_request_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_join_request
    ADD CONSTRAINT school_join_request_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: school_management_role school_management_role_management_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_management_role
    ADD CONSTRAINT school_management_role_management_fkey FOREIGN KEY (school_management_id) REFERENCES public.school_management(id) ON DELETE CASCADE;


--
-- Name: school_management_role school_management_role_role_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_management_role
    ADD CONSTRAINT school_management_role_role_fkey FOREIGN KEY (school_role_id) REFERENCES public.school_role(id) ON DELETE CASCADE;


--
-- Name: school_management school_management_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_management
    ADD CONSTRAINT school_management_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: school_management school_management_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_management
    ADD CONSTRAINT school_management_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profile(id) ON DELETE CASCADE;


--
-- Name: school school_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school
    ADD CONSTRAINT school_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.user_profile(id) ON DELETE RESTRICT;


--
-- Name: school_role_permission school_role_permission_permission_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_role_permission
    ADD CONSTRAINT school_role_permission_permission_fkey FOREIGN KEY (permission_id) REFERENCES public.permission_catalog(id) ON DELETE CASCADE;


--
-- Name: school_role_permission school_role_permission_role_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_role_permission
    ADD CONSTRAINT school_role_permission_role_fkey FOREIGN KEY (school_role_id) REFERENCES public.school_role(id) ON DELETE CASCADE;


--
-- Name: school_role school_role_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_role
    ADD CONSTRAINT school_role_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: term term_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.term
    ADD CONSTRAINT term_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_year(id) ON DELETE CASCADE;


--
-- Name: user_profile user_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profile
    ADD CONSTRAINT user_profile_id_fkey FOREIGN KEY (id) REFERENCES account.app_user(id) ON DELETE CASCADE;


--
-- Name: user_profile user_profile_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profile
    ADD CONSTRAINT user_profile_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE SET NULL;


--
-- Name: parent_student_link parent_student_link_student_id_fkey; Type: FK CONSTRAINT; Schema: student; Owner: -
--

ALTER TABLE ONLY student.parent_student_link
    ADD CONSTRAINT parent_student_link_student_id_fkey FOREIGN KEY (student_id) REFERENCES student.student(id) ON DELETE SET NULL;


--
-- Name: parent_student_link parent_student_link_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: student; Owner: -
--

ALTER TABLE ONLY student.parent_student_link
    ADD CONSTRAINT parent_student_link_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: school_join_code school_join_code_created_by_fkey; Type: FK CONSTRAINT; Schema: student; Owner: -
--

ALTER TABLE ONLY student.school_join_code
    ADD CONSTRAINT school_join_code_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- Name: school_join_code school_join_code_school_id_fkey; Type: FK CONSTRAINT; Schema: student; Owner: -
--

ALTER TABLE ONLY student.school_join_code
    ADD CONSTRAINT school_join_code_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: student student_school_id_fkey; Type: FK CONSTRAINT; Schema: student; Owner: -
--

ALTER TABLE ONLY student.student
    ADD CONSTRAINT student_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.school(id) ON DELETE CASCADE;


--
-- Name: student student_user_profile_id_fkey; Type: FK CONSTRAINT; Schema: student; Owner: -
--

ALTER TABLE ONLY student.student
    ADD CONSTRAINT student_user_profile_id_fkey FOREIGN KEY (user_profile_id) REFERENCES public.user_profile(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

