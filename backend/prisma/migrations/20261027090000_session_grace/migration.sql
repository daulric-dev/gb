-- Recovering from a lost token rotation.
--
-- * rotation_confirmed_at: when the token issued at the last rotation was
--   first presented. While it is null (the client may never have received
--   the rotating response), the replaced token still recovers the session for
--   up to a day from the same user agent, instead of counting as a copied
--   token once SESSION_ROTATION_GRACE_SECONDS has passed. Each rotation resets
--   it. Sessions rotated before this migration count as confirmed, so they
--   keep the old, strict behaviour.

ALTER TABLE account.session
    ADD COLUMN rotation_confirmed_at timestamp(6) with time zone;

UPDATE account.session
    SET rotation_confirmed_at = rotated_at
    WHERE rotated_at IS NOT NULL;
