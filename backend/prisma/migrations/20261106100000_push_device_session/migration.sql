-- Notifications: tie push tokens to the sign-in that registered them.
--
-- public.push_device
--   session_id  the account.session that registered the token (nullable:
--               devices registered before this migration have none and keep
--               receiving pushes until they register again). Deleted with the
--               session (sessions are purged a day after they end); until
--               then the API skips devices whose session was revoked or has
--               expired, and deletes them when the session is revoked. A
--               token registered from another session is only taken over by
--               the same user, or from the session that already holds it.

ALTER TABLE public.push_device
    ADD COLUMN session_id uuid;

ALTER TABLE ONLY public.push_device
    ADD CONSTRAINT push_device_session_id_fkey FOREIGN KEY (session_id) REFERENCES account.session(id) ON DELETE CASCADE;

CREATE INDEX push_device_session_id_idx ON public.push_device USING btree (session_id);
