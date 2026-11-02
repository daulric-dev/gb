---
sidebar_label: 2026-11-02 · Organisation, billing removed
sidebar_position: 1
---

# 2026-11-02 - Self-hosted organisations; billing removed

GradeBook is no longer a hosted, paid service. Each install is self-hosted by
**one organisation**, which may run several schools. This is the first step
of that change (backend). Migrations `20261102100000_organisation` and
`20261102100100_drop_billing`.

## Organisation

- New tables `public.organisation` (one row) and `public.organisation_admin`.
- **First-run setup**: `GET /api/setup/status` (public) → `{ needsSetup }`;
  `POST /api/setup` `{ organisationName }` creates the organisation and makes
  the caller its admin (409 once done). On an install that already has
  schools, only someone who owns or administers one may do it; with
  `ORG_ADMIN_EMAILS` set, only those accounts.
- **Organisation admins** (`/api/organisation`, 403 for anyone else): rename
  the organisation, an overview, add and remove admins, list, create and edit
  schools, appoint a school's admin (the previous one becomes a teacher), and
  sign any user out everywhere.
- `GET /api/auth/me` gains `is_org_admin` and `organisation` (`{ name }` or
  null).
- **Organisation admins manage every school**: the full permission catalog in
  any school without a membership (`AdminGuard` and course access included),
  while staying out of its staff list and chat directory. New
  `GET /api/me/schools` and `PUT /api/me/active-school` `{ schoolId }` switch
  the active school (also for staff in several schools; students 403). Web:
  "Open school dashboard" in the organisation console, a "managing as
  organisation administrator" banner and a sidebar school switcher; mobile:
  "Switch school" in Settings.
- **A page per school in the organisation console** (`/organisation/schools/<id>`,
  linked from the school's name): details, admin, and the school's upload
  limit, logo and features, set without switching into it. New
  `GET /api/organisation/schools/:id` and `/api/organisation/schools/:id/`
  `upload-limit`, `logo/*` and `features`, with the same rules as the
  `/api/schools/current/*` routes.
- New env `ORG_ADMIN_EMAILS`. See [Organisation](../../backend/organisation.md).

## Removed

- **`POST /api/schools`**: schools are created only by organisation admins
  (`POST /api/organisation/schools`), who do not become members.
- **`DEDICATED_DEPLOYMENT`** (and the dedicated onboarding branch): staff
  without a school just save their name and join by request, join code or
  email domain.
- **Billing**: `/api/billing/*`, `/api/platform/*`, the Stripe webhook, the
  402 read-only mode, the billing scheduler, the `stripe` dependency, the dev
  `stripe-listen` container and `bun run stripe:listen` / `stripe:stop`. The
  `billing` schema is dropped with its data; former platform admins become
  organisation admins. Remove `BILLING_*`, `STRIPE_*`, `PLATFORM_ADMIN_EMAILS`
  and `APP_URL` from your environment.

## Deploying

1. Apply the migrations (the container does on start).
2. Remove the old variables above; set `ORG_ADMIN_EMAILS` if you want to
   choose who runs setup.
3. Have an organisation admin (or, on an upgraded install, a school's owner or
   admin) sign in and finish setup.
