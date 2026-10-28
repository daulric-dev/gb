-- Sign-in codes someone else cannot lock you out of.
--
-- * email_code.ip_hash: a keyed hash (HMAC with the server secret, never the
--   address itself) of the client that asked for the code, so sends are
--   capped per (address, client) as well as per address.
-- * email_code_attempt: wrong guesses per (code, client). A client that runs
--   out of guesses on a code stops being able to use it; the owner, asking
--   from elsewhere, still can. email_code.attempts stays the total across
--   clients (the brute-force backstop). Rows go with their code.

ALTER TABLE account.email_code
    ADD COLUMN ip_hash text;

CREATE TABLE account.email_code_attempt (
    code_id uuid NOT NULL,
    ip_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    CONSTRAINT email_code_attempt_pkey PRIMARY KEY (code_id, ip_hash),
    CONSTRAINT email_code_attempt_code_id_fkey FOREIGN KEY (code_id) REFERENCES account.email_code(id) ON DELETE CASCADE
);
