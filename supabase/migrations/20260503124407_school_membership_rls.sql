-- RLS for school_management and school_join_request.
--
-- The rls_auto_enable() event trigger already enables RLS on new public tables,
-- but we explicitly enable it here for clarity / idempotency. With RLS enabled
-- and no policies, all access via the anon/authenticated keys is denied; the
-- service role bypasses RLS so backend writes continue to work.
--
-- Helpers used (defined in the base schema migration):
--   public.is_admin()             - auth.uid() has role='admin' on their active school
--   public.get_user_school_id()   - auth.uid()'s active school_id

-- ── school_management ───────────────────────────────────────────────────────

ALTER TABLE "public"."school_management" ENABLE ROW LEVEL SECURITY;

-- A user can read their own membership rows. Admins can read every row for
-- their school (used to render member lists, etc.).
CREATE POLICY "self_or_admin_read" ON "public"."school_management"
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (public.is_admin() AND school_id = public.get_user_school_id())
  );

-- Only admins of the school can add members directly.
CREATE POLICY "admin_insert" ON "public"."school_management"
  FOR INSERT
  WITH CHECK (
    public.is_admin() AND school_id = public.get_user_school_id()
  );

-- Only admins of the school can change a member's role.
CREATE POLICY "admin_update" ON "public"."school_management"
  FOR UPDATE
  USING (
    public.is_admin() AND school_id = public.get_user_school_id()
  )
  WITH CHECK (
    public.is_admin() AND school_id = public.get_user_school_id()
  );

-- Only admins of the school can remove a member.
CREATE POLICY "admin_delete" ON "public"."school_management"
  FOR DELETE
  USING (
    public.is_admin() AND school_id = public.get_user_school_id()
  );

-- ── school_join_request ─────────────────────────────────────────────────────

ALTER TABLE "public"."school_join_request" ENABLE ROW LEVEL SECURITY;

-- Requester can see their own requests (needed for the pending screen).
-- Admins can see every request targeting their school (the approval queue).
CREATE POLICY "self_or_admin_read" ON "public"."school_join_request"
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (public.is_admin() AND school_id = public.get_user_school_id())
  );

-- A user can only submit a request on their own behalf. The anti-duplicate
-- guarantee is enforced by the partial unique index on (user_id, school_id)
-- WHERE status='pending', not by this policy.
CREATE POLICY "self_insert" ON "public"."school_join_request"
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
  );

-- Only admins of the target school can review (approve/reject) a request.
CREATE POLICY "admin_review" ON "public"."school_join_request"
  FOR UPDATE
  USING (
    public.is_admin() AND school_id = public.get_user_school_id()
  )
  WITH CHECK (
    public.is_admin() AND school_id = public.get_user_school_id()
  );

-- Only admins of the target school can delete a request (cleanup).
CREATE POLICY "admin_delete" ON "public"."school_join_request"
  FOR DELETE
  USING (
    public.is_admin() AND school_id = public.get_user_school_id()
  );
