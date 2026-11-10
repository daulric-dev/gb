# LTI 1.3 (`src/lti`)

GradeBook as an **LTI 1.3 platform**: the organisation registers external tools, teachers add them to course modules as **external tool** items (LTI resource links), staff and students launch them signed in as themselves, and tools post scores back through **Assignment and Grade Services (AGS)**. Behind the `lti` feature (organisation switch, off by default; a school can switch it off). User guide: [docs/content/guide/external-tools.md](../../../docs/content/guide/external-tools.md).

## HTTP routes

**Organisation admin** (`LtiAdminController`, `AuthGuard` + `OrganisationAdminGuard` + `LtiOrganisationFeatureGuard`: `lti` on for the organisation itself; writes `@RequireStepUp()`; every write in the organisation audit log, `entity` `lti_tool` / `lti_deployment` / `lti_platform_key`, never key material - a PEM is audited as a fingerprint):

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/organisation/lti` | `{ platform: { issuer, authUrl, jwksUrl, tokenUrl, keys }, tools }` - the values an admin gives the tool, and the registry. |
| GET | `/api/organisation/lti/tools/:toolId` | One tool. |
| POST | `/api/organisation/lti/tools` | Register (`CreateLtiToolDto`). GradeBook issues `clientId` (`gb-…`) and one deployment per `schoolIds` entry, or one for every school. URLs must be https outside development, no credentials or fragment; a JWKS URL or a pasted RSA (≥ 2048-bit) public key is required. |
| PATCH | `/api/organisation/lti/tools/:toolId` | Change anything above. Switching AGS or the tool off revokes its access tokens; a new key source drops the cached JWKS. |
| DELETE | `/api/organisation/lti/tools/:toolId` | 204; 409 while module items use it (switch it off instead). |
| POST | `/api/organisation/lti/tools/:toolId/deployments` | `{ schoolId \| null }`: add a deployment (409 for a duplicate). |
| DELETE | `/api/organisation/lti/tools/:toolId/deployments/:deploymentId` | 409 while module items launch through it. |
| POST | `/api/organisation/lti/keys/rotate` | Retire the active platform key and make a new one. |

**Course** (`LtiCourseController`, `AuthGuard` + `FeatureGuard` `@RequireFeature('lti')` on the `:courseId`'s school):

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| GET | `/api/courses/:courseId/lti/tools` | Staff role | Enabled tools deployed to every school or to this course's school. |
| POST | `/api/courses/:courseId/lti/modules/:moduleId/items` | Manage role | `{ toolId, title, customParams?, points?, indent? }`: a module item of type `external_tool` plus its resource link. With `points` (AGS tools only) an `offline` activity is created and published through `ActivityService` and linked as the item's line item. Audited as `module_item`. |
| GET / PATCH | `/api/courses/:courseId/lti/items/:itemId` | Staff / manage role | The item's tool, custom parameters and line item; PATCH `{ customParams }` (audited as `lti_resource_link`). |
| POST | `/api/courses/:courseId/lti/launches` | Staff role, or an enrolled student (published item and module) | `{ moduleItemId }` → `{ url, expiresAt }`: the tool's login initiation URL with `iss`, `login_hint`, `target_link_uri`, `lti_message_hint`, `client_id`, `lti_deployment_id`. 60 per minute per session. |

Title, indent, publishing, moving and removing an external tool item use the ordinary module item routes (`src/course`); the generic create route refuses `external_tool`.

**Public, for tools** (`LtiPublicController`, no session):

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/lti/jwks` | The platform JWKS: the active key and keys retired in the last 7 days (`kid`, RS256, `use: sig`). Cached 5 minutes. |
| GET / POST | `/api/lti/auth` | OIDC authentication endpoint (form_post). The only cross-site form post besides the SAML ACS; exempt from the CSRF origin check (`common/csrf.ts`). Answers an HTML page (below). `auth-ip` 300/h. |
| POST | `/api/lti/token` | OAuth 2 client credentials with `private_key_jwt` (form or JSON body). Answers `{ access_token, token_type: 'Bearer', expires_in: 900, scope }` or an RFC 6749 error. `auth-ip` 600/h plus the per-tool limit. |

**AGS** (`LtiAgsController`, `LtiAgsGuard`: bearer access token, per-tool rate limit; then the course must be in a school the tool is deployed to with `lti` on):

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/lti/ags/courses/:courseId/lineitems` | `lineitem` or `lineitem.readonly` | The tool's own line items in the course (`resource_link_id`, `tag`, `resource_id`, `limit` ≤ 100 filters). |
| POST | `/api/lti/ags/courses/:courseId/lineitems` | `lineitem` | `{ scoreMaximum, label, resourceLinkId?, tag?, resourceId? }`: creates and publishes an offline activity (via `ActivityService`) and the line item. |
| GET | `…/lineitems/:lineItemId` | `lineitem` or `lineitem.readonly` | One line item. |
| POST | `…/lineitems/:lineItemId/scores` | `score` | A score (`application/vnd.ims.lis.v1.score+json`), 204. See below. |
| GET | `…/lineitems/:lineItemId/results` | `result.readonly` | Marks in that column for users the tool has a `sub` for (`user_id` filter). |

Updating or deleting a line item through AGS is not supported (404); teachers manage the column in GradeBook.

## Launch flow

1. `LtiLaunchService.start`: course role via `CourseAccessService.roleIn` (staff), else an enrolled student (`requireStudent`, item and module published). The tool must be enabled and the item's deployment still reach the course's school. Roles: student → `Learner`; teacher → `Instructor`; TA → `Instructor` + `Instructor#TeachingAssistant`; admin → `Instructor` + `institution/person#Administrator`. The user's pairwise `sub` (an `lti_subject` row, per tool) is the `login_hint`. A random 32-byte `lti_message_hint` is stored as SHA-256 in `lti_launch` (5 minutes, single use, bound to user, tool and resource link).
2. The tool redirects (or form-posts) to `/api/lti/auth`. Checked, in order: `client_id` is a tool; `redirect_uri` is one of its registered URIs exactly (otherwise nothing is ever posted anywhere); `scope=openid`, `response_type=id_token`, `response_mode=form_post`, `prompt` none/absent, a `nonce`; the hint exists, belongs to this tool and to this `login_hint`, is unused and unexpired; when a GradeBook session cookie comes with the request it must be the ticket's user; the tool is enabled and `lti` is on for the school. The ticket is spent with one conditional update (race-safe), the nonce recorded in `lti_replay` (unique per tool: a replayed nonce is refused).
3. The answer is an HTML page served by the API (so the web app's CSP is untouched) with `Content-Security-Policy: default-src 'none'; script-src 'nonce-…'; form-action <redirect origin>; frame-ancestors 'none'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, auto-posting `id_token` (+ `state`) to the redirect URI. Refusals are an escaped error page, never a redirect.

id_token (RS256, `kid`, 5 minutes): `iss` (API_URL), `aud`/`azp` (client id), `sub`, `iat`, `exp`, `nonce`, `message_type` `LtiResourceLinkRequest`, `version` `1.3.0`, `deployment_id`, `target_link_uri`, `resource_link` `{ id, title }`, `roles`, `context` `{ id, label, title, type: [CourseOffering] }`, `tool_platform`, `launch_presentation` `{ document_target: 'window' }`, `custom` (tool's, overridden by the item's), and with AGS on the `lti-ags/claim/endpoint` (all four scopes, `lineitems`, `lineitem` when the item has a column). `name` / `given_name` / `family_name` and `email` only when the tool's `send_name` / `send_email` are on.

## AGS token and scores

- **Client assertion**: RS256 only (no `none`/HMAC); `iss` = `sub` = client id of an enabled tool with AGS on; signature against the tool's pasted key or its JWKS (`kid`; a set with a single key may omit it); `aud` the token URL (or the issuer); `exp` not past, at most 10 minutes ahead; `iat` not in the future (60 s skew); `jti` required and single use (`lti_replay`). Only AGS scopes are granted; none → `invalid_scope`. `lti` off for the organisation → 403.
- **Access tokens** are 32 random bytes, stored as SHA-256 (`lti_access_token`), 15 minutes.
- **Scores** (`LtiAgsService.postScore`): `userId` must be a `sub` this tool has; that user must be a student on the course's roster; a `timestamp` not newer than the last score for that user and line item is a 409. Only `gradingProgress: FullyGraded` with a `scoreGiven` writes a mark: `scoreGiven / scoreMaximum × points`, two decimals, clamped to `0..points`, through **`SubmissionService.grade`** (the public marking API: same checks, rubric clearing, audit entry and `grade` event as a teacher's mark; the activity must be published), `comment` as feedback (≤ 2000). The write is attributed to the item's author if still staff in the course, else the longest-serving teacher (409 if there is none). An `lti_score` audit entry (`via: 'lti'`, tool, raw and scaled score) is added. Every score, written or not, updates `lti_score`.
- **Late-work interaction**: tool columns are `offline` activities without a submission time, so any late-work penalty the grading module applies to handed-in work does not apply to them; if late handling is ever applied inside `SubmissionService.grade`, tool scores follow it like any other mark.

## Security notes

- Tool JWKS fetches go through `safeWebhookFetch` (`src/integrations/delivery/webhook-sender.ts`): public addresses only (unless `WEBHOOK_ALLOW_PRIVATE=true`), DNS pinned per request, no redirects, 5 s timeout, 64 KB cap. Keys are cached 5 minutes; an unknown `kid` refetches at most every 30 s.
- The platform private key is sealed with `secret-box` (`DATA_ENCRYPTION_KEY`, else `AUTH_SECRET`; HKDF info `gradebook:lti-platform-key:v1`, the `kid` as AAD). If that key changes, rotate the platform key. One active key (partial unique index).
- Per-tool rate limit on the token and AGS endpoints: `LTI_TOOL_RATE_LIMIT` requests per minute (default 300) in the shared cache.
- AGS media types (`…score+json`, `…lineitem+json`) are parsed only under `/api/lti/ags/`; form bodies only on `/api/lti/auth` and `/api/lti/token` (and the SAML ACS).
- The mobile app's in-app browser has no session cookie, so the launch ticket (single use, 5 minutes, unguessable) is what binds a launch to its user there.
- Expired launches, replay entries and tokens are purged opportunistically when launches start.

## Data

`public.lti_platform_key`, `lti_tool`, `lti_deployment`, `lti_resource_link` (one per `external_tool` module item, cascades with it and the course; restricts tool/deployment deletes), `lti_line_item` (one per activity; cascades with it), `lti_subject` (pairwise `sub`; cascades with the user, so erasure removes it), `lti_launch`, `lti_replay`, `lti_access_token`, `lti_score`; `course.module_item_type` gains `external_tool` (the item-type CHECK requires a title). Schema in `prisma/schema/lti.prisma`, migration `20261121100000_lti`. Course copy and import skip external tool items.

## Tests

```bash
cd backend && bun test src/lti src/course/module.service.test.ts src/features
```

`lti.test.ts`: JWT signing/verification and claim checks (alg `none`/HS256 refused); role mapping; launch URL and ticket binding; id_token claims verified against the published JWKS; privacy (no name/email unless allowed); hint and nonce single use, expiry; wrong client, redirect URI, login hint, tool, user and flag-off refusals; platform key creation, sealing and rotation; token flow with a signed client assertion, jti replay, wrong key/audience/lifetime/issuer, flag off 403, AGS off, rate limit; JWKS SSRF guard (loopback, private, link-local, IPv6 loopback), kid selection, redirects not followed, weak keys ignored; score scaling and the grading-service call, non-FullyGraded not written, out-of-order 409, other tool's line item, unknown user, missing scope, undeployed school, flag off, off-roster student, delegate fallback; organisation feature guard; CSRF exemption and form-body scope.
