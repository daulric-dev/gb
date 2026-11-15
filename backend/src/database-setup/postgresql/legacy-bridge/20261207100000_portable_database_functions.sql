-- Database functions whose logic now lives in TypeScript services (Prisma
-- queries and transactions), so nothing calls them any more:
--
-- * chat.unread_counts: ChatService.unreadCountsFor (one grouped count).
-- * public.join_school_by_email_domain: EmailDomainService.seat.
-- * public.redeem_school_join_code: StudentMembershipService.redeem.
-- * public.seed_school_system_roles and its trigger on public.school:
--   seedSchoolSystemRoles (src/permission/system-roles.ts), called in the
--   transaction of every code path that creates a school.
--
-- Existing schools already have their system roles; nothing to backfill.
-- Kept for now (see prisma/DATABASE_PORTABILITY.md): the student left_at
-- trigger, the peer-review not-self trigger and the audit append-only
-- triggers.

DROP TRIGGER IF EXISTS seed_school_system_roles_trigger ON public.school;
DROP FUNCTION IF EXISTS public.seed_school_system_roles();
DROP FUNCTION IF EXISTS chat.unread_counts(uuid);
DROP FUNCTION IF EXISTS public.join_school_by_email_domain(uuid, uuid, public.email_domain_audience, public.role);
DROP FUNCTION IF EXISTS public.redeem_school_join_code(uuid, text);
