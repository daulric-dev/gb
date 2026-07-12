-- Aggregate unread message counts per conversation for a user in a single
-- round-trip, replacing the per-conversation COUNT queries the app issued in a
-- loop (O(conversations) round-trips on every unread-badge poll).
--
-- Returns one row per conversation the user is a member of, with the number of
-- messages sent by *other* members after the user's last_read_at (or all such
-- messages when they've never read the conversation).

CREATE OR REPLACE FUNCTION "chat"."unread_counts"("p_user_id" "uuid")
RETURNS TABLE("conversation_id" "uuid", "unread" bigint)
LANGUAGE "sql"
STABLE
AS $$
  SELECT cm.conversation_id, COUNT(m.id) AS unread
  FROM chat.conversation_member cm
  LEFT JOIN chat.message m
    ON m.conversation_id = cm.conversation_id
    AND m.sender_id <> p_user_id
    AND m.deleted_at IS NULL
    AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
  WHERE cm.user_id = p_user_id
  GROUP BY cm.conversation_id;
$$;
