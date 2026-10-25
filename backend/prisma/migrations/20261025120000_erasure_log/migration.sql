-- GDPR erasure log.
--
-- Every erasure of personal data (an account deleted, a file or chat message
-- deleted, a discussion post removed, soft-deleted rows purged after the
-- retention period, ...) writes one row here in the same transaction as the
-- erasure itself. After a backup is restored, `bun run erasure:replay --since
-- <backup time>` re-applies every erasure logged since then.
--
-- The table holds ids only - never names, emails, message bodies or file
-- names. `replay` is a list of steps (delete / update by uuid, delete storage
-- objects under uuid-only prefixes) that the replay tool validates against a
-- fixed list of tables and columns before running.
--
-- It lives in its own `compliance` schema: it is not application data, it
-- has its own retention (ERASURE_LOG_RETENTION_DAYS, default 400 days, longer
-- than any backup), it can be dumped or granted on its own
-- (`pg_dump -n compliance`), and it has no foreign keys so it outlives the
-- rows it describes. Rows are also copied to object storage
-- (ERASURE_LOG_S3_PREFIX) right after commit, because a database restore
-- rolls this table back too; `exported_at` records that copy.

--
-- Name: compliance; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS compliance;


--
-- Name: erasure_log; Type: TABLE; Schema: compliance; Owner: -
--

CREATE TABLE compliance.erasure_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurred_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    kind text NOT NULL,
    subject_table text NOT NULL,
    subject_ids uuid[] NOT NULL,
    school_id uuid,
    actor text NOT NULL,
    reason text NOT NULL,
    replay jsonb NOT NULL,
    exported_at timestamp(6) with time zone,
    CONSTRAINT erasure_log_pkey PRIMARY KEY (id),
    CONSTRAINT erasure_log_kind_check CHECK ((kind = ANY (ARRAY['account'::text, 'student'::text, 'school_membership'::text, 'file'::text, 'folder'::text, 'chat_message'::text, 'discussion_topic'::text, 'discussion_reply'::text, 'course'::text, 'attendance_session'::text]))),
    CONSTRAINT erasure_log_reason_check CHECK ((reason = ANY (ARRAY['user_request'::text, 'admin'::text, 'retention_purge'::text, 'merge'::text]))),
    CONSTRAINT erasure_log_actor_check CHECK (((actor = 'system'::text) OR (actor ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text))),
    CONSTRAINT erasure_log_subject_ids_check CHECK ((cardinality(subject_ids) > 0)),
    CONSTRAINT erasure_log_replay_check CHECK ((jsonb_typeof(replay) = 'object'::text))
);


--
-- Name: erasure_log_occurred_at_idx; Type: INDEX; Schema: compliance; Owner: -
--

CREATE INDEX erasure_log_occurred_at_idx ON compliance.erasure_log USING btree (occurred_at);


--
-- Name: erasure_log_school_idx; Type: INDEX; Schema: compliance; Owner: -
--

CREATE INDEX erasure_log_school_idx ON compliance.erasure_log USING btree (school_id, occurred_at);


--
-- Name: erasure_log_unexported_idx; Type: INDEX; Schema: compliance; Owner: -
--

CREATE INDEX erasure_log_unexported_idx ON compliance.erasure_log USING btree (occurred_at) WHERE (exported_at IS NULL);
