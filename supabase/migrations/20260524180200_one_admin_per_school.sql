-- Enforce "at most one admin per school" at the database level.
--
-- The application "first admin wins" bootstrap rule in
-- auth.service.onboard() and school.service.createJoinRequest() is
-- a check-then-insert without a transaction, so two concurrent requests
-- can both observe "no admin yet" and both succeed in becoming admin.
--
-- A partial unique index serializes this at the storage layer: the second
-- INSERT will fail with 23505 (unique_violation), and the service can
-- treat that as "lost the race, fall back to the join-request path".

CREATE UNIQUE INDEX IF NOT EXISTS
  "school_management_one_admin_per_school"
  ON "public"."school_management" ("school_id")
  WHERE "role" = 'admin';
