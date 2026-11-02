---
sidebar_label: Dedicated Deployment
---

# Dedicated Deployment

`DEDICATED_DEPLOYMENT` is gone. Every GradeBook install is now self-hosted by one organisation, which may run one school or several: the first person to sign in names the organisation and becomes its admin, and organisation admins create the schools and appoint their admins. See [Organisation](./backend/organisation.md) and [Environment variables](./environment-variables.md#organisation).

A full self-hosting guide is coming. Until then, [Developer guide](./developer-guide.md) covers deploying the API, the web app and the database.

Upgrading an install that ran with `DEDICATED_DEPLOYMENT=true`: remove the variable (and `NEXT_PUBLIC_DEDICATED_DEPLOYMENT`), deploy, then have the school's admin or owner sign in and finish setup.
