---
sidebar_label: Webhooks
---
# Webhooks (integrations)

A school can have GradeBook **POST platform events to its own systems** - a student information system, a data warehouse, a script on the school network. Each webhook is a URL plus the event types it wants; GradeBook sends each event as signed JSON. A school may have **several webhooks**, so different event types can go to different systems.

Code: `backend/src/integrations` (see its README). Data: `public.school_webhook`, `public.webhook_delivery`, `public.integration_audit_log` (migration `20261104100000_webhooks`).

## Turning it on

Webhooks are behind the **`integrations`** feature ("Integrations (webhooks)"), **off by default** because data leaves the platform. An organisation admin turns it on in **Organisation → Features**; a school admin can still switch it off for their school. While it is off for a school, every webhook route answers `403 FEATURE_DISABLED`, no events are queued and queued deliveries are not sent.

## Setting up a webhook

On the web: **Settings → Integrations** (the school's admin) or a school's page in the organisation console (**Organisation → Schools → <school></school> → Integrations**).

1. **Add webhook**: a name, the URL, and the events (grouped, with "All events in this group" toggles). Optionally, **Headers** your endpoint expects (see [Custom headers](#custom-headers-receiver-authentication)) and **your own signing secret**. Saving asks you to **Confirm it's you** (step-up, an emailed code).
2. Copy the **signing secret** shown once. It is stored encrypted and never shown again; if you lose it, **Rotate secret**. If you entered your own, it is not shown back - it is simply saved.
3. Press **Test**: GradeBook sends a `ping` straight away and shows the HTTP status. The delivery list shows every attempt with its payload and the first 1 KB of your response; **Redeliver** sends one again.

**Any URL is allowed**, `http` or `https`, including private and internal addresses (`http://10.0.0.5/...`, `http://sis.internal/...`): GradeBook is self-hosted and schools call systems on their own network. Only the syntax is checked. The UI warns about plain `http`, which sends names, emails and marks unencrypted - use `https` unless the network is trusted.

Who: the school's admin (`school:update` plus the admin role) and organisation admins (any school). Creating, editing, deleting and rotating the secret need step-up; Test and Redeliver change nothing and do not. Everything - including tests, redeliveries and automatic switch-offs - is written to the school's **integration activity log** (never the secret, never a header value).

## What is sent

```http
POST /your/path HTTP/1.1
Content-Type: application/json
User-Agent: GradeBook-Webhooks/1
X-GradeBook-Event: grade.recorded
X-GradeBook-Event-Id: 9b2c...         (the event id - dedupe on it)
X-GradeBook-School-Id: 3c5e...        (the school)
X-GradeBook-Api-Version: 1
X-GradeBook-Delivery: 3f0e...         (this delivery's id)
X-GradeBook-Timestamp: 1793178000     (unix seconds, this attempt)
X-GradeBook-Signature: v1=5d41402abc4b2a76b9719d911017c592...

{"event_type":"grade.recorded","message":"Ada Lovelace received 17.5/20 for Quadratics homework in Year 10 Mathematics","data":{"school":{"id":"3c5e...","name":"Riverside High School"},...}}
```

The body has **exactly three keys**:

| Field        | Meaning |
| ------------ | ------- |
| `event_type` | The event type, also in the `X-GradeBook-Event` header. Switch on either. |
| `message`    | One human-readable sentence about the event, built from `data` - e.g. "Ada Lovelace handed in Quadratics homework in Year 10 Mathematics" - ready to post in a chat channel or a log. **Plain text** (at most 280 characters, no line breaks, not HTML-escaped: escape it yourself before putting it in HTML). The wording may change; use `data` for logic. When a name is missing it reads "A student ...", "a course" and so on. |
| `data`       | The event's data (below), always starting with `school: { id, name }`. Ids plus minimal names: people as `{ id, firstName, lastName, email }` (students by student record id, staff by account id), courses as `{ id, name, code }`, activities as `{ id, title, kind, points }`. Other events avoid free text beyond titles - no submission text, feedback or announcement bodies. The opt-in `audit.changed` event is an exception and includes redacted before/after values and actor details. |

Everything else is in the headers:

| Header                    | Meaning |
| ------------------------- | ------- |
| `X-GradeBook-Event`       | The event type (same as `event_type`). |
| `X-GradeBook-Event-Id`    | The **event id** (uuid). The same for every webhook and every retry or redelivery of this event - **dedupe on it**. |
| `X-GradeBook-School-Id`   | The school's id (same as `data.school.id`). |
| `X-GradeBook-Api-Version` | `1`. Fields may be added within a version; nothing is removed or renamed without a new version. |
| `X-GradeBook-Delivery`    | This delivery's id (each retry of a delivery keeps it; a redelivery gets a new one). |
| `X-GradeBook-Timestamp`   | When this attempt was sent (unix seconds); part of the signature. |
| `X-GradeBook-Signature`   | `v1=<hex HMAC-SHA256>` - see [Verifying the signature](#verifying-the-signature). |

The full catalog, with each type's JSON Schema, an example and the example's `message` (`exampleMessage`), is also served at `GET /api/webhooks/event-types` (any school admin or organisation admin).

### Audit-log changes

`audit.changed` is an explicit per-webhook subscription in the **Audit log**
event group. It is not sent unless selected. Each delivery contains the
school-scoped audit entry's actor, entity, action, timestamp, and redacted
before/after values. These values may contain personal data, so send them only
to a trusted receiver over HTTPS. The webhook delivery list and its payload
follow the configured webhook delivery-retention policy.

Only school-scoped entries are eligible; organisation-wide audit entries are
not sent to school webhooks. Delivery rows are enqueued in the same database
transaction as the audit entry, so rolled-back changes are not delivered.

**Before this format** the body was `{ id, type, apiVersion, createdAt, school, data }`. Deliveries stored in that shape (still queued for a retry, or redelivered later) are **converted when sent**: `school` moves into `data`, a `message` is added, and `id` / `apiVersion` travel as the headers above (`createdAt` is dropped; the delivery list keeps when it was created). The converted body is stored, so the delivery list shows what was sent.

Plus any [custom headers](#custom-headers-receiver-authentication) the webhook has.

## Custom headers (receiver authentication)

If your endpoint only accepts requests that carry a key of yours, add it as a header - like an environment variable, a **name** and a **value**. Optional: leave it empty if your endpoint needs nothing beyond the signature. Each header is sent exactly as `Name: value` with **every** request: events, retries, **Test** pings and **Redeliver**.

```http
Authorization: Bearer 8f3c1d...          (a bearer token)
X-API-Key: sk_live_51H...                (an API key header)
Authorization: Basic c2lzOnBhc3N3b3Jk    (basic auth: base64 of "user:password", encoded by you)
X-Tenant: riverside                      (anything else your receiver wants)
```

Rules (the same in the UI and the API):

- Up to **20** headers per webhook. Names are letters, digits and `-` (at most 100 characters) and unique per webhook ignoring case.
- **Reserved** - set by GradeBook, refused as custom names: `Content-Type`, `Content-Length`, `Host`, `User-Agent`, `Transfer-Encoding`, `Connection` and anything starting `X-GradeBook-`. `Authorization` **is** allowed.
- Values are 1-4096 printable ASCII characters; no line breaks.

**Values are write-only.** Each is stored encrypted (AES-256-GCM, its own key derived from `AUTH_SECRET`, bound to the school, the webhook and that header - never interchangeable with the signing secret) and never shown again: the API returns names only. To change one, type a new value; leave it blank to keep the saved one (you can still rename it); remove the row to delete it. They are never logged, never stored with deliveries (if your receiver echoes one back in its response, the kept excerpt shows `[redacted]`), never in alert emails, and the activity log records only which header names were added, removed, renamed or given a new value. Changing headers is part of editing the webhook, so it needs step-up. If the server's `AUTH_SECRET` changes, saved values can't be read: deliveries fail with "enter it again" until you re-enter them.

## Verifying the signature

`X-GradeBook-Signature` is `v1=` + hex **HMAC-SHA256** of `"<X-GradeBook-Timestamp>.<raw body>"` with the webhook's secret (the whole string, `whsec_...`). Verify against the **raw bytes** you received (before any JSON parsing), compare in constant time, and reject timestamps more than 5 minutes from your clock to stop replays.

**Your own signing secret**: if your receiver already has a secret, enter it when adding the webhook or under **Rotate secret → Use my own signing secret** (16-256 printable ASCII characters, no leading or trailing space). It is used exactly like a generated one (the HMAC key is the whole string), stored encrypted, and **not echoed back** - the answer has `secret: null`, `secretGenerated: false`. Leave it blank and GradeBook generates one (`whsec_...`) and shows it once.

Node (Express):

```js
import crypto from "node:crypto";
import express from "express";

const SECRET = process.env.GRADEBOOK_WEBHOOK_SECRET; // whsec_...
const TOLERANCE_S = 300;
const seen = new Set(); // use a database table in production

const app = express();
app.post("/gradebook", express.raw({ type: "application/json" }), (req, res) => {
  const ts = Number(req.get("X-GradeBook-Timestamp"));
  const sig = req.get("X-GradeBook-Signature") ?? "";
  if (!ts || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_S) return res.sendStatus(400);

  const expected = "v1=" + crypto.createHmac("sha256", SECRET).update(`${ts}.${req.body}`).digest("hex");
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return res.sendStatus(401);

  const eventId = req.get("X-GradeBook-Event-Id");
  if (seen.has(eventId)) return res.sendStatus(200); // already handled
  seen.add(eventId);

  const event = JSON.parse(req.body.toString("utf8")); // { event_type, message, data }
  console.log(event.message); // "Ada Lovelace received 17.5/20 for ..."

  switch (event.event_type) { // same as the X-GradeBook-Event header
    case "grade.recorded":
      // event.data.school, event.data.student, event.data.activity, event.data.grade ...
      break;
    case "attendance.recorded":
      break;
    case "ping":
      break;
    default:
      break; // ignore types you do not handle
  }
  res.sendStatus(204); // answer quickly; do slow work in the background
});
app.listen(8080);
```

Python (Flask):

```python
import hashlib, hmac, json, os, time
from flask import Flask, request, abort

SECRET = os.environ["GRADEBOOK_WEBHOOK_SECRET"].encode()  # whsec_...
TOLERANCE_S = 300
seen = set()  # use a database table in production
app = Flask(__name__)

@app.post("/gradebook")
def gradebook():
    raw = request.get_data()  # the exact bytes
    try:
        ts = int(request.headers.get("X-GradeBook-Timestamp", ""))
    except ValueError:
        abort(400)
    if abs(time.time() - ts) > TOLERANCE_S:
        abort(400)
    expected = "v1=" + hmac.new(SECRET, f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get("X-GradeBook-Signature", ""), expected):
        abort(401)

    event_id = request.headers.get("X-GradeBook-Event-Id")
    if event_id in seen:
        return "", 200
    seen.add(event_id)

    event = json.loads(raw)  # {"event_type", "message", "data"}
    app.logger.info(event["message"])
    kind = event["event_type"]  # same as the X-GradeBook-Event header
    if kind == "grade.recorded":
        pass  # event["data"]["school"], ["student"], ["activity"], ["grade"]
    elif kind == "student.enrolled":
        pass
    return "", 204
```

## TLS / SSL verification

On an `https` URL GradeBook checks the receiver's certificate against the public certificate authorities, as a browser would, so nobody between GradeBook and your server can read or change deliveries. Each webhook has a **Security** section:

- **Verify SSL/TLS certificate** - on by default (and for every webhook made before this setting existed). A delivery to a server whose certificate does not check out fails with the TLS error (e.g. `self signed certificate`), and is retried like any failure.
- **Trusted CA certificate (optional)** - for a server on your network with a **self-signed or private-CA certificate**: paste that CA's certificate (PEM, one or more `-----BEGIN CERTIFICATE-----` blocks, at most 64 KB). GradeBook then trusts **only** those CAs for this webhook (instead of the public ones) with verification still on - **the safe option**. It is checked on save (each certificate must parse; a private key is refused), stored normalised and in plain text (a CA certificate is public), and shown back as SHA-256 fingerprints only; **Remove** clears it (`caCert: ""`).
- **Turning verification off** sends even when the certificate can't be verified: **deliveries can be read or changed by anyone in between**. Use it only to test. It is part of editing the webhook (step-up), is written to the activity log (`tls_verification_disabled` / `tls_verification_enabled`; CA changes as `tls_ca_changed` with fingerprints, never the PEM), emails the school's admin and the organisation admins ("TLS verification turned off for webhook X - deliveries can be intercepted"), shows a red **TLS not verified** badge on the webhook, and marks every delivery attempt made that way (`tlsVerified: false`, a badge in the delivery list).

Plain `http` URLs have no TLS, so these settings do not apply to them (their deliveries have `tlsVerified: null`); the UI keeps warning that http travels unencrypted.

How it works: the backend runs on Bun, and each https delivery passes `tls: { rejectUnauthorized, ca }` to Bun's `fetch` (`src/integrations/webhooks/webhook-tls.ts`). Under plain Node the option is ignored, which fails safe (verification stays on with the public CAs).

## Delivery, retries and ordering

- **Success** is any `2xx` within **10 seconds**. Redirects are **not followed** (a `3xx` is a failure - update the URL instead). At most 1 KB of your response is read and kept.
- **Retries**: a failed attempt is retried with exponential backoff and ±20% jitter - after about 1 min, 5 min, 30 min, 2 h, 5 h, 8 h and 8 h: **8 attempts over roughly 24 hours** (`WEBHOOK_MAX_ATTEMPTS`). Then the delivery is marked **gave up** (`abandoned`); you can still Redeliver it.
- **Ordering is not guaranteed**, and an event can arrive **more than once** (a retry after a timeout you did process, a redelivery). **Dedupe by the `X-GradeBook-Event-Id` header.** Ordering by `X-GradeBook-Timestamp` gives send order, not event order; where it matters, use the times in `data` (e.g. `submittedAt`, `checkedInAt`).
- **Auto-disable**: after **50 failed attempts in a row** (`WEBHOOK_MAX_CONSECUTIVE_FAILURES`) the webhook switches itself off, shows why, and the school's admin and every organisation admin are emailed. Fix the receiver and switch it back on (that resets the count). Deliveries queued while it is off are not sent.
- **Secret rotation is immediate**: the old secret stops working the moment you rotate, so update the receiver straight after.
- Tests and redeliveries are sent at once, are not retried and do not count towards auto-disable.

How it runs: events are written to `public.webhook_delivery` after the change that caused them committed (an event never fails the change). Every API instance polls for due deliveries every 5 s (`WEBHOOK_POLL_INTERVAL_MS`) and claims them atomically (`FOR UPDATE SKIP LOCKED` plus a 2-minute lease, so a crashed instance's work is retried, never sent twice at once). With `USE_REDIS=true` a BullMQ queue (`webhook-deliver`) sends each delivery as it falls due and the database is checked once a minute as a backstop.

## Retention

Payloads contain personal data, so deliveries are deleted after **30 days** (`WEBHOOK_DELIVERY_RETENTION_DAYS`) by the daily retention job (`src/retention`). Deleting a webhook deletes its deliveries; deleting a school deletes its webhooks, deliveries and activity log.

## API

All under `/api`. School admin routes act on the active school; organisation routes on any school (`:schoolId`). Lists use [HTTP QUERY](./http-query.md) with a JSON body.

| Route (school admin)                                   | Organisation console                             | Step-up | Notes                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /schools/current/webhooks`                      | `GET /organisation/schools/:schoolId/webhooks` |         | Never the secret (`hasSecret`, `secretUnreadable`) or a header value (`headers: [{ id, name, hasValue: true, valueUnreadable }]`), last delivery, `insecure` for plain http, `tls: { verify, caFingerprints }`                                                                                                                                                         |
| `POST .../webhooks`                                  | same                                             | yes     | `{ name, url, events, enabled?, headers?, signingSecret?, tls?: { verify?, caCert? } }` → `{ webhook, secret, secretGenerated }` - the only time a generated secret is returned (`secret: null` when you supplied it). `events: ["*"]` means every current type and is stored expanded                                                                         |
| `GET .../webhooks/:id`                               | same                                             |         |                                                                                                                                                                                                                                                                                                                                             |
| `PATCH .../webhooks/:id`                             | same                                             | yes     | any of `name`, `url`, `events`, `enabled`, `headers`, `tls: { verify?, caCert? ('' clears) }`; switching on clears an auto-disable. `headers` is the full desired list `[{ id?, name, value? }]`: a saved `id` without `value` keeps its value (rename allowed), with `value` replaces it; no `id` is new (value required); saved headers left out are deleted |
| `DELETE .../webhooks/:id`                            | same                                             | yes     | 204; deliveries go with it                                                                                                                                                                                                                                                                                                                  |
| `POST .../webhooks/:id/rotate-secret`                | same                                             | yes     | body optional `{ signingSecret? }` → `{ webhook, secret, secretGenerated }` (`secret` null for your own); the old secret stops working at once                                                                                                                                                                                       |
| `POST .../webhooks/:id/test`                         | same                                             |         | sends `ping` now; returns the delivery                                                                                                                                                                                                                                                                                                    |
| `QUERY .../webhooks/:id/deliveries`                  | same                                             |         | body `{ status?, eventType?, limit? (≤200, default 50), before? }`, newest first                                                                                                                                                                                                                                                         |
| `GET .../webhooks/deliveries/:deliveryId`            | same                                             |         | payload (the body as sent), response excerpt, attempts, `tlsVerified`                                                                                                                                                                                                                                                                                                    |
| `POST .../webhooks/deliveries/:deliveryId/redeliver` | same                                             |         | a new delivery with the same event id, sent now (an old-shape payload is converted to `{ event_type, message, data }`)                                                                                                                                                                                                                                                                                          |
| `QUERY .../webhooks/audit`                           | same                                             |         | body `{ limit?, before? }`: the activity log                                                                                                                                                                                                                                                                                              |
| `GET /webhooks/event-types`                          |                                                  |         | the catalog; no school or feature needed                                                                                                                                                                                                                                                                                                    |

`403 FEATURE_DISABLED` while `integrations` is off; `403 STEP_UP_REQUIRED` until the session confirms; `404` for another school's webhook or delivery, or an unknown school.

## Event types

Not available: **`grades.released`** - GradeBook has no separate "release grades" step (a mark is visible once entered), so `grade.recorded` covers it. Custom role grants, school-admin appointments from the organisation console and per-student automatic absences (counted in `attendance.session_closed`) are not sent as events.

| Group                | Types                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grades & submissions | `submission.handed_in`, `grade.recorded`, `quiz.completed`                                                                                           |
| Attendance           | `attendance.session_opened`, `attendance.session_closed`, `attendance.recorded`                                                                      |
| People & enrolment   | `student.joined_school`, `student.left_school`, `student.enrolled`, `student.unenrolled`, `staff.joined`, `staff.left`, `staff.role_changed` |
| Courses & content    | `course.created`, `course.archived`, `activity.published`, `announcement.posted`                                                                   |
| System               | `ping` (Test button only)                                                                                                                                |

### Grades & submissions

#### `submission.handed_in`

**Assignment handed in.** A student handed in an assignment (text, files or both). Quizzes send quiz.completed instead.

Example body:

```json
{
  "event_type": "submission.handed_in",
  "message": "Ada Lovelace handed in Quadratics homework in Year 10 Mathematics",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "submission": {
      "id": "8d0f2b4e-6a8c-4e0d-9f4b-5c7d9e1f3a6b",
      "submittedAt": "2026-11-04T09:15:00.000Z"
    },
    "activity": {
      "id": "4a6c8e0b-3d5f-4b7a-9c1e-2f4a6b8c0d3e",
      "title": "Quadratics homework",
      "kind": "assignment",
      "points": 20
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "student": {
      "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@students.riverside.edu"
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"submission":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"submittedAt":{"type":"string","format":"date-time"}},"required":["id","submittedAt"],"additionalProperties":false},"activity":{"type":"object","description":"The activity (assignment, quiz or offline work)","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"kind":{"type":"string","enum":["assignment","quiz","offline"]},"points":{"type":["number","null"]}},"required":["id","title","kind","points"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["school","submission","activity","course","student"],"additionalProperties":false}
```

#### `grade.recorded`

**Mark entered or changed.** A teacher entered or changed a mark, excused a student (or lifted it), or a gradebook CSV import changed a mark. One event per student and activity.

Example body:

```json
{
  "event_type": "grade.recorded",
  "message": "Ada Lovelace received 17.5/20 for Quadratics homework in Year 10 Mathematics",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "submission": {
      "id": "8d0f2b4e-6a8c-4e0d-9f4b-5c7d9e1f3a6b"
    },
    "activity": {
      "id": "4a6c8e0b-3d5f-4b7a-9c1e-2f4a6b8c0d3e",
      "title": "Quadratics homework",
      "kind": "assignment",
      "points": 20
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "student": {
      "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@students.riverside.edu"
    },
    "grade": {
      "score": 17.5,
      "points": 20,
      "status": "graded",
      "excused": false
    },
    "gradedBy": {
      "id": "2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b",
      "firstName": "Grace",
      "lastName": "Hopper",
      "email": "g.hopper@riverside.edu"
    },
    "source": "teacher"
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"submission":{"type":"object","properties":{"id":{"type":["string","null"],"format":"uuid"}},"required":["id"],"additionalProperties":false},"activity":{"type":"object","description":"The activity (assignment, quiz or offline work)","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"kind":{"type":"string","enum":["assignment","quiz","offline"]},"points":{"type":["number","null"]}},"required":["id","title","kind","points"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"grade":{"type":"object","description":"The mark: score out of points; null score when excused without one","properties":{"score":{"type":["number","null"]},"points":{"type":["number","null"]},"status":{"type":"string","enum":["draft","submitted","graded"]},"excused":{"type":"boolean"}},"required":["score","points","status","excused"],"additionalProperties":false},"gradedBy":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"source":{"type":"string","enum":["teacher","excuse","import"]}},"required":["school","submission","activity","course","student","grade","gradedBy","source"],"additionalProperties":false}
```

#### `quiz.completed`

**Quiz completed.** A student submitted a quiz attempt; it was marked automatically.

Example body:

```json
{
  "event_type": "quiz.completed",
  "message": "Ada Lovelace completed Fractions quiz in Year 10 Mathematics and scored 8/10",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "submission": {
      "id": "8d0f2b4e-6a8c-4e0d-9f4b-5c7d9e1f3a6b",
      "attempt": 1
    },
    "activity": {
      "id": "5b7d9f1c-4e6a-4c8b-8d2f-3a5b7c9d1e4f",
      "title": "Fractions quiz",
      "kind": "quiz",
      "points": 10
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "student": {
      "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@students.riverside.edu"
    },
    "grade": {
      "score": 8,
      "points": 10,
      "status": "graded",
      "excused": false
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"submission":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"attempt":{"type":["integer","null"]}},"required":["id","attempt"],"additionalProperties":false},"activity":{"type":"object","description":"The activity (assignment, quiz or offline work)","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"kind":{"type":"string","enum":["assignment","quiz","offline"]},"points":{"type":["number","null"]}},"required":["id","title","kind","points"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"grade":{"type":"object","description":"The mark: score out of points; null score when excused without one","properties":{"score":{"type":["number","null"]},"points":{"type":["number","null"]},"status":{"type":"string","enum":["draft","submitted","graded"]},"excused":{"type":"boolean"}},"required":["score","points","status","excused"],"additionalProperties":false}},"required":["school","submission","activity","course","student","grade"],"additionalProperties":false}
```

### Attendance

#### `attendance.session_opened`

**Attendance opened.** A teacher opened an attendance session in a course.

Example body:

```json
{
  "event_type": "attendance.session_opened",
  "message": "Grace Hopper opened attendance (Period 1) in Year 10 Mathematics",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "session": {
      "id": "7c9e1a3d-5f7b-4d9c-8e3a-4b6c8d0e2f5a",
      "title": "Period 1",
      "openedAt": "2026-11-04T08:30:00.000Z",
      "closesAt": "2026-11-04T08:45:00.000Z",
      "requiresCode": true,
      "lateAfterMinutes": 5
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "openedBy": {
      "id": "2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b",
      "firstName": "Grace",
      "lastName": "Hopper",
      "email": "g.hopper@riverside.edu"
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"session":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":["string","null"]},"openedAt":{"type":"string","format":"date-time"},"closesAt":{"type":"string","format":"date-time"},"requiresCode":{"type":"boolean"},"lateAfterMinutes":{"type":["integer","null"]}},"required":["id","title","openedAt","closesAt","requiresCode","lateAfterMinutes"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"openedBy":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["school","session","course","openedBy"],"additionalProperties":false}
```

#### `attendance.session_closed`

**Attendance closed.** An attendance session closed (early, or when its time ran out). Everyone who had not checked in was marked absent; the counts include them.

Example body:

```json
{
  "event_type": "attendance.session_closed",
  "message": "Attendance (Period 1) closed in Year 10 Mathematics: 24 present, 2 late, 3 absent, 1 excused",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "session": {
      "id": "7c9e1a3d-5f7b-4d9c-8e3a-4b6c8d0e2f5a",
      "title": "Period 1",
      "openedAt": "2026-11-04T08:30:00.000Z",
      "closedAt": "2026-11-04T08:45:00.000Z"
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "counts": {
      "present": 24,
      "late": 2,
      "absent": 3,
      "excused": 1
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"session":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":["string","null"]},"openedAt":{"type":"string","format":"date-time"},"closedAt":{"type":"string","format":"date-time"}},"required":["id","title","openedAt","closedAt"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"counts":{"type":"object","properties":{"present":{"type":"integer"},"late":{"type":"integer"},"absent":{"type":"integer"},"excused":{"type":"integer"}},"required":["present","late","absent","excused"],"additionalProperties":false}},"required":["school","session","course","counts"],"additionalProperties":false}
```

#### `attendance.recorded`

**Attendance recorded.** A student checked in (code or QR), or a teacher set or changed a student's attendance. Absences filled in automatically at close are in attendance.session_closed's counts, not sent one by one.

Example body:

```json
{
  "event_type": "attendance.recorded",
  "message": "Ada Lovelace was marked late in Year 10 Mathematics",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "session": {
      "id": "7c9e1a3d-5f7b-4d9c-8e3a-4b6c8d0e2f5a"
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "student": {
      "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@students.riverside.edu"
    },
    "record": {
      "status": "late",
      "method": "qr",
      "checkedInAt": "2026-11-04T08:37:12.000Z"
    },
    "recordedBy": null
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"session":{"type":"object","properties":{"id":{"type":"string","format":"uuid"}},"required":["id"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"record":{"type":"object","properties":{"status":{"type":"string","enum":["present","late","absent","excused"]},"method":{"type":"string","enum":["self","qr","teacher","auto"]},"checkedInAt":{"type":["string","null"],"format":"date-time"}},"required":["status","method","checkedInAt"],"additionalProperties":false},"recordedBy":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["school","session","course","student","record","recordedBy"],"additionalProperties":false}
```

### People & enrolment

#### `student.joined_school`

**Student joined the school.** A student joined the school with its join code or a student email domain.

Example body:

```json
{
  "event_type": "student.joined_school",
  "message": "Ada Lovelace joined Riverside High School with the join code",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "student": {
      "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@students.riverside.edu"
    },
    "via": "join_code"
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"via":{"type":"string","enum":["join_code","email_domain"]}},"required":["school","student","via"],"additionalProperties":false}
```

#### `student.left_school`

**Student marked inactive.** A school admin marked a student inactive (the student has left). Students have no other way to leave a school; their record and marks stay.

Example body:

```json
{
  "event_type": "student.left_school",
  "message": "Ada Lovelace was marked inactive at Riverside High School",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "student": {
      "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@students.riverside.edu"
    },
    "via": "marked_inactive"
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"via":{"type":"string","enum":["marked_inactive"]}},"required":["school","student","via"],"additionalProperties":false}
```

#### `student.enrolled`

**Student enrolled in a course.** A student was added to a course by its staff, or joined it with the course's code.

Example body:

```json
{
  "event_type": "student.enrolled",
  "message": "Ada Lovelace was enrolled in Year 10 Mathematics",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "student": {
      "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@students.riverside.edu"
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "via": "staff"
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"via":{"type":"string","enum":["staff","join_code"]}},"required":["school","student","course","via"],"additionalProperties":false}
```

#### `student.unenrolled`

**Student removed from a course.** A student was removed from a course. `dropped` is true when they had work in it (kept, marked dropped), false when the enrolment was deleted.

Example body:

```json
{
  "event_type": "student.unenrolled",
  "message": "Ada Lovelace was removed from Year 10 Mathematics (kept as dropped)",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "student": {
      "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@students.riverside.edu"
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "dropped": true
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"dropped":{"type":"boolean"}},"required":["school","student","course","dropped"],"additionalProperties":false}
```

#### `staff.joined`

**Staff member joined.** A school admin approved a join request, or a staff member joined with a staff email domain.

Example body:

```json
{
  "event_type": "staff.joined",
  "message": "Grace Hopper joined Riverside High School as a teacher",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "staff": {
      "id": "2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b",
      "firstName": "Grace",
      "lastName": "Hopper",
      "email": "g.hopper@riverside.edu"
    },
    "role": "teacher",
    "via": "join_request"
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"staff":{"type":"object","description":"A staff member (user profile id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"role":{"type":["string","null"],"enum":["admin","teacher","member",null]},"via":{"type":"string","enum":["join_request","email_domain"]}},"required":["school","staff","role","via"],"additionalProperties":false}
```

#### `staff.left`

**Staff member left.** A staff member left the school, or a school admin removed them.

Example body:

```json
{
  "event_type": "staff.left",
  "message": "Grace Hopper was removed from Riverside High School",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "staff": {
      "id": "2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b",
      "firstName": "Grace",
      "lastName": "Hopper",
      "email": "g.hopper@riverside.edu"
    },
    "via": "removed"
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"staff":{"type":"object","description":"A staff member (user profile id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"via":{"type":"string","enum":["left","removed"]}},"required":["school","staff","via"],"additionalProperties":false}
```

#### `staff.role_changed`

**Staff member's role changed.** A school admin changed a staff member's base role (admin, teacher, member). Custom role grants are not sent.

Example body:

```json
{
  "event_type": "staff.role_changed",
  "message": "Grace Hopper's role changed from teacher to admin",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "staff": {
      "id": "2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b",
      "firstName": "Grace",
      "lastName": "Hopper",
      "email": "g.hopper@riverside.edu"
    },
    "role": {
      "before": "teacher",
      "after": "admin"
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"staff":{"type":"object","description":"A staff member (user profile id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"role":{"type":"object","properties":{"before":{"type":["string","null"],"enum":["admin","teacher","member",null]},"after":{"type":["string","null"],"enum":["admin","teacher","member",null]}},"required":["before","after"],"additionalProperties":false}},"required":["school","staff","role"],"additionalProperties":false}
```

### Courses & content

#### `course.created`

**Course created.** A course was created (from scratch or as a copy).

Example body:

```json
{
  "event_type": "course.created",
  "message": "Grace Hopper created Year 10 Mathematics",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "createdBy": {
      "id": "2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b",
      "firstName": "Grace",
      "lastName": "Hopper",
      "email": "g.hopper@riverside.edu"
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"createdBy":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["school","course","createdBy"],"additionalProperties":false}
```

#### `course.archived`

**Course archived.** A course was archived.

Example body:

```json
{
  "event_type": "course.archived",
  "message": "Year 10 Mathematics was archived",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false}},"required":["school","course"],"additionalProperties":false}
```

#### `activity.published`

**Activity published.** An assignment, quiz or offline activity was published (or reopened) to students.

Example body:

```json
{
  "event_type": "activity.published",
  "message": "Assignment Quadratics homework was published in Year 10 Mathematics",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "activity": {
      "id": "4a6c8e0b-3d5f-4b7a-9c1e-2f4a6b8c0d3e",
      "title": "Quadratics homework",
      "kind": "assignment",
      "points": 20,
      "dueAt": "2026-11-11T23:59:00.000Z"
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"activity":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"kind":{"type":"string","enum":["assignment","quiz","offline"]},"points":{"type":["number","null"]},"dueAt":{"type":["string","null"],"format":"date-time"}},"required":["id","title","kind","points","dueAt"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false}},"required":["school","activity","course"],"additionalProperties":false}
```

#### `announcement.posted`

**Announcement posted.** A school-wide or course announcement was posted. Only the title is sent, never the body.

Example body:

```json
{
  "event_type": "announcement.posted",
  "message": "Grace Hopper posted the announcement \"Exam timetable published\" in Year 10 Mathematics",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "announcement": {
      "id": "1e3a5c7b-9d2f-4b4d-8f6a-7c9e1a3d5f8b",
      "title": "Exam timetable published",
      "scope": "course"
    },
    "course": {
      "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
      "name": "Year 10 Mathematics",
      "code": "MATH10"
    },
    "author": {
      "id": "2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b",
      "firstName": "Grace",
      "lastName": "Hopper",
      "email": "g.hopper@riverside.edu"
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"announcement":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"scope":{"type":"string","enum":["school","course"]}},"required":["id","title","scope"],"additionalProperties":false},"course":{"type":["object","null"],"description":"The course, for a course announcement","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"author":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["school","announcement","course","author"],"additionalProperties":false}
```

### System

#### `ping`

**Test (ping).** Sent by the Test button, to check the URL and your signature verification. Always delivered to the webhook being tested, whatever it subscribes to.

Example body:

```json
{
  "event_type": "ping",
  "message": "Test event from GradeBook",
  "data": {
    "school": {
      "id": "3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b",
      "name": "Riverside High School"
    },
    "webhook": {
      "id": "0a2c4e6f-8b1d-4f3a-9c5e-6d8f0a2b4c7d",
      "name": "Student information system"
    }
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"school":{"type":"object","description":"The school","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false},"webhook":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false}},"required":["school","webhook"],"additionalProperties":false}
```
