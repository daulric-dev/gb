-- Account deletion safeguards: the organisation gets an owner.
--
-- public.organisation.owner_id is the person who owns the organisation
-- (whoever ran first-run setup, or whoever it was transferred to with
-- POST /api/organisation/transfer-ownership). ON DELETE RESTRICT, like
-- public.school.owner_id: an owner's account cannot be deleted until
-- ownership is handed over. The API refuses first (409
-- ACCOUNT_DELETION_BLOCKED, src/auth), so the constraint is the backstop.
ALTER TABLE public.organisation ADD COLUMN owner_id uuid;

ALTER TABLE public.organisation
  ADD CONSTRAINT organisation_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.user_profile(id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX organisation_owner_id_idx ON public.organisation (owner_id);

-- Backfill rule: the owner is the organisation admin (a stored row in
-- public.organisation_admin) added first, i.e. the earliest created_at -
-- the person who ran first-run setup. Ties go to a self-added row
-- (created_by is NULL or the admin themself, which is how setup writes it),
-- then to the lowest user_id so the result is deterministic. An install
-- whose admins all come from ORG_ADMIN_EMAILS (no rows) keeps owner_id NULL;
-- any organisation admin may then assign ownership.
UPDATE public.organisation o
SET owner_id = (
  SELECT a.user_id
  FROM public.organisation_admin a
  ORDER BY a.created_at ASC,
           (a.created_by IS NULL OR a.created_by = a.user_id) DESC,
           a.user_id ASC
  LIMIT 1
)
WHERE o.owner_id IS NULL;
