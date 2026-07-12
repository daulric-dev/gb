-- Count a user's unread in-school announcements server-side with a NOT EXISTS
-- anti-join, replacing the app pattern of fetching every announcement id plus
-- every read receipt and diffing them in JS (transfer + work scaled with the
-- school's total announcement history rather than with the answer).

CREATE OR REPLACE FUNCTION "public"."announcement_unread_count"(
  "p_user_id" "uuid",
  "p_school_id" "uuid"
)
RETURNS bigint
LANGUAGE "sql"
STABLE
AS $$
  SELECT COUNT(*)
  FROM public.announcement a
  WHERE a.school_id = p_school_id
    AND a.author_user_profile_id <> p_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.announcement_read r
      WHERE r.announcement_id = a.id
        AND r.user_profile_id = p_user_id
    );
$$;
