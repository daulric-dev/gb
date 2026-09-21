-- Chat's row-level security never worked, and the way it failed was hiding a
-- second problem underneath it.
--
-- `member_reads_membership` guards chat.conversation_member with a policy whose
-- USING clause selects from chat.conversation_member. Evaluating it requires
-- evaluating it, and Postgres stops with:
--
--     ERROR:  infinite recursion detected in policy for relation "conversation_member"
--
-- The conversation and message policies both test membership through that same
-- table, so all three fail the same way. Every chat query from a user-scoped
-- client errors out. Nothing has been exposed by it: the policies fail closed,
-- and chat.service.ts uses the service client throughout, which bypasses RLS -
-- so the breakage has been invisible rather than harmful.
--
-- The trap is what happens when someone fixes only the recursion. Restoring the
-- SELECT policies also restores `member_updates_own_membership`, which pins
-- `user_id` and nothing else. A member could then move their own row into any
-- conversation:
--
--     UPDATE chat.conversation_member
--        SET conversation_id = '<someone else''s DM>', role = 'owner'
--      WHERE user_id = auth.uid();
--
-- The new row still satisfies `user_id = auth.uid()`, so it is allowed, and the
-- membership row is what every read policy trusts - the attacker is now in the
-- conversation and can read its messages. Today only the recursion prevents
-- this. So both are fixed here, together.

-- ── 1. Membership test that does not re-enter the policy ──────────────────
--
-- SECURITY DEFINER, so the body runs as the owner. RLS is not applied to a
-- table's owner, so reading conversation_member here does not evaluate its
-- policy, and the recursion cannot arise. search_path is pinned because a
-- SECURITY DEFINER function that resolves names through the caller's
-- search_path is how these become privilege escalations.
CREATE OR REPLACE FUNCTION "chat"."is_conversation_member"("conversation" "uuid")
  RETURNS boolean
  LANGUAGE "sql"
  STABLE
  SECURITY DEFINER
  SET "search_path" = "chat", "pg_temp"
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM "chat"."conversation_member" m
     WHERE m."conversation_id" = "is_conversation_member"."conversation"
       AND m."user_id" = "auth"."uid"()
  );
$$;

REVOKE ALL ON FUNCTION "chat"."is_conversation_member"("uuid") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "chat"."is_conversation_member"("uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "chat"."is_conversation_member"("uuid") TO "service_role";

-- ── 2. The three read policies, now going through the helper ──────────────

DROP POLICY IF EXISTS "member_reads_membership" ON "chat"."conversation_member";
CREATE POLICY "member_reads_membership" ON "chat"."conversation_member"
  FOR SELECT
  USING ("chat"."is_conversation_member"("conversation_id"));

DROP POLICY IF EXISTS "member_reads_conversation" ON "chat"."conversation";
CREATE POLICY "member_reads_conversation" ON "chat"."conversation"
  FOR SELECT
  USING ("chat"."is_conversation_member"("id"));

DROP POLICY IF EXISTS "member_reads_messages" ON "chat"."message";
CREATE POLICY "member_reads_messages" ON "chat"."message"
  FOR SELECT
  USING ("chat"."is_conversation_member"("conversation_id"));

-- ── 3. Close the membership-move escalation ───────────────────────────────
--
-- Two independent controls, because the policy alone cannot express this.
-- WITH CHECK sees only the new row, never the old one, so "conversation_id must
-- not change" is not something it can say. Column privileges can.
--
-- The only update a member legitimately makes to their own membership is
-- marking it read. Granting exactly that column means conversation_id and role
-- are unwritable by an authenticated caller no matter what the policy allows -
-- the escalation above is rejected by the grant before a policy is consulted.
REVOKE UPDATE ON TABLE "chat"."conversation_member" FROM "authenticated";
GRANT UPDATE ("last_read_at") ON TABLE "chat"."conversation_member" TO "authenticated";

-- Stated explicitly rather than inherited from USING. Postgres would apply the
-- USING clause to the new row anyway; writing it out means a later edit to one
-- clause cannot silently change the other.
DROP POLICY IF EXISTS "member_updates_own_membership" ON "chat"."conversation_member";
CREATE POLICY "member_updates_own_membership" ON "chat"."conversation_member"
  FOR UPDATE
  USING ("user_id" = "auth"."uid"())
  WITH CHECK ("user_id" = "auth"."uid"());

-- ── 4. anon has no business in chat ───────────────────────────────────────
--
-- The table grants were written as GRANT ALL to authenticated, anon and
-- service_role alike. No policy admits anon - every one of them tests
-- auth.uid(), which is null for an anonymous caller - so this removes surface
-- rather than behaviour. Chat is never public, and an unauthenticated caller
-- should be refused by the grant, not only by a policy.
REVOKE ALL ON TABLE "chat"."conversation" FROM "anon";
REVOKE ALL ON TABLE "chat"."conversation_member" FROM "anon";
REVOKE ALL ON TABLE "chat"."message" FROM "anon";
