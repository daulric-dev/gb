---
sidebar_label: Dedicated Deployment
---

# Dedicated Deployment

`DEDICATED_DEPLOYMENT` is gone. Every GradeBook install is self-hosted by one organisation, which may run one school or several: the first person to sign in names the organisation and becomes its admin, and organisation admins create the schools and appoint their admins. See [Organisation](./backend/organisation.md) and [Environment variables](./environment-variables.md#organisation).

For application hosting architecture, runtime versions, resource starting
allocations, network requirements, and a production checklist, see
[Hosting Requirements](./hosting-requirements.md). The [Developer guide](./developer-guide.md)
covers deploying the API, web app, and database.

Upgrading an install that ran with `DEDICATED_DEPLOYMENT=true`: remove the variable (and `NEXT_PUBLIC_DEDICATED_DEPLOYMENT`), deploy, then have the school's admin or owner sign in and finish setup.
