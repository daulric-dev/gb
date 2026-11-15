-- Originally made authenticator-app MFA required for privileged roles and
-- switched it on for every organisation. Superseded: two-step verification
-- is opt-in (each person turns it on; an organisation may require it for
-- admins from its settings), so this bridge step changes nothing. Kept so
-- databases that ran the original are recorded consistently.
SELECT 1;
