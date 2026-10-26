-- Session hardening.
--
-- * absolute_expires_at: a session never outlives this, however active it is
--   (SESSION_MAX_AGE_DAYS, default 90 days from sign-in). The sliding 30-day
--   expires_at is capped at it. Existing sessions get created_at + 90 days.
-- * previous_token_hash / rotated_at: the token is replaced at each daily
--   renewal. The token it replaced keeps working for a short grace period
--   (SESSION_ROTATION_GRACE_SECONDS); presented after that, it is treated as
--   a copied token and the whole session is revoked.
-- * revoked_reason: why a session ended (logout, user, others, admin,
--   token_reuse, account, deactivated, ...). Null for sessions still live or
--   revoked before this migration.
-- * device: a friendly label parsed from the user agent at sign-in
--   ("Chrome on macOS", "GradeBook app on iPhone 15 (iOS 19)"), shown in
--   Signed-in devices and used to spot sign-ins from a new device.

--
-- Name: session; Type: TABLE; Schema: account; Owner: -
--

ALTER TABLE account.session
    ADD COLUMN absolute_expires_at timestamp(6) with time zone,
    ADD COLUMN previous_token_hash text,
    ADD COLUMN rotated_at timestamp(6) with time zone,
    ADD COLUMN revoked_reason text,
    ADD COLUMN device text;

UPDATE account.session
    SET absolute_expires_at = created_at + interval '90 days'
    WHERE absolute_expires_at IS NULL;

ALTER TABLE account.session
    ALTER COLUMN absolute_expires_at SET DEFAULT (CURRENT_TIMESTAMP + interval '90 days'),
    ALTER COLUMN absolute_expires_at SET NOT NULL;


--
-- Name: session_previous_token_hash_key; Type: INDEX; Schema: account; Owner: -
--

CREATE UNIQUE INDEX session_previous_token_hash_key ON account.session USING btree (previous_token_hash);


--
-- Name: session_user_id_live_idx; Type: INDEX; Schema: account; Owner: -
--
-- A user's live sessions, newest first (Signed-in devices, revoke-others).
--

CREATE INDEX session_user_id_live_idx ON account.session USING btree (user_id, created_at DESC) WHERE (revoked_at IS NULL);


--
-- Name: known_device; Type: TABLE; Schema: account; Owner: -
--
-- Devices a user has signed in on, for the "New sign-in" alert: a sign-in is
-- from a new device when no row for its fingerprint (a SHA-256 of the sign-in
-- method and device label) was seen in the last 90 days. Kept apart from
-- account.session because ended sessions are purged after a day. No IPs or
-- user agents; refreshed at sign-in and at each daily token rotation, and
-- purged by the retention job after 90 days unused.
--

CREATE TABLE account.known_device (
    user_id uuid NOT NULL,
    fingerprint text NOT NULL,
    first_seen_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT known_device_pkey PRIMARY KEY (user_id, fingerprint),
    CONSTRAINT known_device_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.app_user(id) ON DELETE CASCADE
);


--
-- Name: known_device_last_seen_at_idx; Type: INDEX; Schema: account; Owner: -
--

CREATE INDEX known_device_last_seen_at_idx ON account.known_device USING btree (last_seen_at);
