---
sidebar_label: 2026-11-02 · HTTP QUERY for list endpoints
sidebar_position: 2
---

# 2026-11-02 - HTTP QUERY for search and filter lists

The search and filter list endpoints moved from `GET` with a query string to
the HTTP `QUERY` method with the filters in a JSON body. There is no GET
fallback: a `GET` to these paths is now a 404. Full list, request shape and
proxy notes: [HTTP QUERY](../../backend/http-query.md).

- `QUERY /api/courses`, `/api/students`, `/api/files`,
  `/api/files/folders/contents`, `/api/chat/conversations/:id/messages`,
  `/api/portal/me/notifications`, `/api/organisation/schools`,
  `/api/organisation/invites`, `/api/schools/current/sso/audit`,
  `/api/organisation/schools/:id/sso/audit`.
- New body DTOs `ListOrganisationSchoolsQueryDto`, `ListInvitesQueryDto` and
  `ListSsoAuditQueryDto`; the existing `*QueryDto` classes are now body DTOs.
  `limit` on the SSO audit log is now 1-200 (a larger value is a 400, it used
  to be capped) and `before` must be a UUID.
- An empty QUERY body means every default. CORS allows `QUERY`.
- Web and mobile use the new `apiQuery()` helper.

## Upgrading

- **Mobile**: older app builds send `GET` and their course, student, file,
  chat history and notice screens fail. Once the first build with `QUERY` is
  live in both stores, raise `MOBILE_MIN_VERSION` to it.
- **Proxies**: anything in front of the API must pass the `QUERY` method and
  its body. The bundled nginx config does.
