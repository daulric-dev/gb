-- Existing deleted accounts must also lose the copied actor name and email,
-- including accounts whose ids-only erasure-log entry has already expired.
-- Keep the audit event itself; the normal two-year retention purge removes it
-- when its retention period ends. A missing user_profile alone is not enough:
-- an account may still be active in another context.
BEGIN;
SELECT set_config('gradebook.audit_purge', 'on', true);

UPDATE public.audit_log AS a
SET actor_name = NULL,
    actor_email = NULL
WHERE (a.actor_name IS NOT NULL OR a.actor_email IS NOT NULL)
  AND a.actor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM account.app_user AS u WHERE u.id = a.actor_id)
  AND NOT EXISTS (SELECT 1 FROM public.user_profile AS p WHERE p.id = a.actor_id);

COMMIT;
