---
sidebar_label: Webhooks
---

# Webhooks (integrations)

A school can have GradeBook **POST platform events to its own systems** - a student information system, a data warehouse, a script on the school network. Each webhook is a URL plus the event types it wants; GradeBook sends each event as signed JSON. A school may have **several webhooks**, so different event types can go to different systems.

Code: `backend/src/integrations` (see its README). Data: `public.school_webhook`, `public.webhook_delivery`, `public.integration_audit_log` (migration `20261104100000_webhooks`).

## Turning it on

Webhooks are behind the **`integrations`** feature ("Integrations (webhooks)"), **off by default** because data leaves the platform. An organisation admin turns it on in **Organisation → Features**; a school admin can still switch it off for their school. While it is off for a school, every webhook route answers `403 FEATURE_DISABLED`, no events are queued and queued deliveries are not sent.

## Setting up a webhook

On the web: **Settings → Integrations** (the school's admin) or a school's page in the organisation console (**Organisation → Schools → <school> → Integrations**).

1. **Add webhook**: a name, the URL, and the events (grouped, with "All events in this group" toggles). Saving asks you to **Confirm it's you** (step-up, an emailed code).
2. Copy the **signing secret** shown once. It is stored encrypted and never shown again; if you lose it, **Rotate secret**.
3. Press **Test**: GradeBook sends a `ping` straight away and shows the HTTP status. The delivery list shows every attempt with its payload and the first 1 KB of your response; **Redeliver** sends one again.

**Any URL is allowed**, `http` or `https`, including private and internal addresses (`http://10.0.0.5/...`, `http://sis.internal/...`): GradeBook is self-hosted and schools call systems on their own network. Only the syntax is checked. The UI warns about plain `http`, which sends names, emails and marks unencrypted - use `https` unless the network is trusted.

Who: the school's admin (`school:update` plus the admin role) and organisation admins (any school). Creating, editing, deleting and rotating the secret need step-up; Test and Redeliver change nothing and do not. Everything - including tests, redeliveries and automatic switch-offs - is written to the school's **integration activity log** (never the secret).

## What is sent

```http
POST /your/path HTTP/1.1
Content-Type: application/json
User-Agent: GradeBook-Webhooks/1
X-GradeBook-Event: grade.recorded
X-GradeBook-Delivery: 3f0e...        (this delivery's id)
X-GradeBook-Timestamp: 1793178000     (unix seconds)
X-GradeBook-Signature: v1=5d41402abc4b2a76b9719d911017c592...

{"id":"9b2c...","type":"grade.recorded","apiVersion":1,"createdAt":"2026-11-04T09:15:00.000Z","school":{"id":"...","name":"Riverside High"},"data":{...}}
```

The envelope:

| Field | Meaning |
| --- | --- |
| `id` | The **event id** (uuid). The same for every webhook and every retry or redelivery of this event - dedupe on it. |
| `type` | The event type, also in the `X-GradeBook-Event` header. Switch on either. |
| `apiVersion` | `1`. Fields may be added within a version; nothing is removed or renamed without a new version. |
| `createdAt` | When the event happened (ISO 8601). |
| `school` | `{ id, name }` |
| `data` | The event's data (below). Ids plus minimal names: people as `{ id, firstName, lastName, email }` (students by student record id, staff by account id), courses as `{ id, name, code }`, activities as `{ id, title, kind, points }`. Never free text beyond titles - no submission text, feedback or announcement bodies. |

The full catalog, with each type's JSON Schema and an example, is also served at `GET /api/webhooks/event-types` (any school admin or organisation admin).

## Verifying the signature

`X-GradeBook-Signature` is `v1=` + hex **HMAC-SHA256** of `"<X-GradeBook-Timestamp>.<raw body>"` with the webhook's secret (the whole string, `whsec_...`). Verify against the **raw bytes** you received (before any JSON parsing), compare in constant time, and reject timestamps more than 5 minutes from your clock to stop replays.

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

  const event = JSON.parse(req.body.toString("utf8"));
  if (seen.has(event.id)) return res.sendStatus(200); // already handled
  seen.add(event.id);

  switch (req.get("X-GradeBook-Event")) { // same as event.type
    case "grade.recorded":
      // event.data.student, event.data.activity, event.data.grade ...
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

    event = json.loads(raw)
    if event["id"] in seen:
        return "", 200
    seen.add(event["id"])

    kind = request.headers.get("X-GradeBook-Event")  # same as event["type"]
    if kind == "grade.recorded":
        pass  # event["data"]["student"], ["activity"], ["grade"]
    elif kind == "student.enrolled":
        pass
    return "", 204
```

## Delivery, retries and ordering

- **Success** is any `2xx` within **10 seconds**. Redirects are **not followed** (a `3xx` is a failure - update the URL instead). At most 1 KB of your response is read and kept.
- **Retries**: a failed attempt is retried with exponential backoff and ±20% jitter - after about 1 min, 5 min, 30 min, 2 h, 5 h, 8 h and 8 h: **8 attempts over roughly 24 hours** (`WEBHOOK_MAX_ATTEMPTS`). Then the delivery is marked **gave up** (`abandoned`); you can still Redeliver it.
- **Ordering is not guaranteed**, and an event can arrive **more than once** (a retry after a timeout you did process, a redelivery). **Dedupe by the envelope `id`.** Use `createdAt` if you need to order events.
- **Auto-disable**: after **50 failed attempts in a row** (`WEBHOOK_MAX_CONSECUTIVE_FAILURES`) the webhook switches itself off, shows why, and the school's admin and every organisation admin are emailed. Fix the receiver and switch it back on (that resets the count). Deliveries queued while it is off are not sent.
- **Secret rotation is immediate**: the old secret stops working the moment you rotate, so update the receiver straight after.
- Tests and redeliveries are sent at once, are not retried and do not count towards auto-disable.

How it runs: events are written to `public.webhook_delivery` after the change that caused them committed (an event never fails the change). Every API instance polls for due deliveries every 5 s (`WEBHOOK_POLL_INTERVAL_MS`) and claims them atomically (`FOR UPDATE SKIP LOCKED` plus a 2-minute lease, so a crashed instance's work is retried, never sent twice at once). With `USE_REDIS=true` a BullMQ queue (`webhook-deliver`) sends each delivery as it falls due and the database is checked once a minute as a backstop.

## Retention

Payloads contain personal data, so deliveries are deleted after **30 days** (`WEBHOOK_DELIVERY_RETENTION_DAYS`) by the daily retention job (`src/retention`). Deleting a webhook deletes its deliveries; deleting a school deletes its webhooks, deliveries and activity log.

## API

All under `/api`. School admin routes act on the active school; organisation routes on any school (`:schoolId`). Lists use [HTTP QUERY](./http-query.md) with a JSON body.

| Route (school admin) | Organisation console | Step-up | Notes |
| --- | --- | --- | --- |
| `GET /schools/current/webhooks` | `GET /organisation/schools/:schoolId/webhooks` | | Never the secret (`hasSecret`, `secretUnreadable`), last delivery, `insecure` for plain http |
| `POST .../webhooks` | same | yes | `{ name, url, events, enabled? }` → `{ webhook, secret }` - the only time the secret is returned. `events: ["*"]` means every current type and is stored expanded |
| `GET .../webhooks/:id` | same | | |
| `PATCH .../webhooks/:id` | same | yes | any of `name`, `url`, `events`, `enabled`; switching on clears an auto-disable |
| `DELETE .../webhooks/:id` | same | yes | 204; deliveries go with it |
| `POST .../webhooks/:id/rotate-secret` | same | yes | `{ webhook, secret }`; the old secret stops working at once |
| `POST .../webhooks/:id/test` | same | | sends `ping` now; returns the delivery |
| `QUERY .../webhooks/:id/deliveries` | same | | body `{ status?, eventType?, limit? (≤200, default 50), before? }`, newest first |
| `GET .../webhooks/deliveries/:deliveryId` | same | | payload, response excerpt, attempts |
| `POST .../webhooks/deliveries/:deliveryId/redeliver` | same | | a new delivery with the same event id, sent now |
| `QUERY .../webhooks/audit` | same | | body `{ limit?, before? }`: the activity log |
| `GET /webhooks/event-types` | | | the catalog; no school or feature needed |

`403 FEATURE_DISABLED` while `integrations` is off; `403 STEP_UP_REQUIRED` until the session confirms; `404` for another school's webhook or delivery, or an unknown school.

## Event types

Not available: **`grades.released`** - GradeBook has no separate "release grades" step (a mark is visible once entered), so `grade.recorded` covers it. Custom role grants, school-admin appointments from the organisation console and per-student automatic absences (counted in `attendance.session_closed`) are not sent as events.

| Group | Types |
| --- | --- |
| Grades & submissions | `submission.handed_in`, `grade.recorded`, `quiz.completed` |
| Attendance | `attendance.session_opened`, `attendance.session_closed`, `attendance.recorded` |
| People & enrolment | `student.joined_school`, `student.left_school`, `student.enrolled`, `student.unenrolled`, `staff.joined`, `staff.left`, `staff.role_changed` |
| Courses & content | `course.created`, `course.archived`, `activity.published`, `announcement.posted` |
| System | `ping` (Test button only) |

### Grades & submissions

#### `submission.handed_in`

**Assignment handed in.** A student handed in an assignment (text, files or both). Quizzes send quiz.completed instead.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"submission":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"submittedAt":{"type":"string","format":"date-time"}},"required":["id","submittedAt"],"additionalProperties":false},"activity":{"type":"object","description":"The activity (assignment, quiz or offline work)","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"kind":{"type":"string","enum":["assignment","quiz","offline"]},"points":{"type":["number","null"]}},"required":["id","title","kind","points"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["submission","activity","course","student"],"additionalProperties":false}
```

#### `grade.recorded`

**Mark entered or changed.** A teacher entered or changed a mark, excused a student (or lifted it), or a gradebook CSV import changed a mark. One event per student and activity.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"submission":{"type":"object","properties":{"id":{"type":["string","null"],"format":"uuid"}},"required":["id"],"additionalProperties":false},"activity":{"type":"object","description":"The activity (assignment, quiz or offline work)","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"kind":{"type":"string","enum":["assignment","quiz","offline"]},"points":{"type":["number","null"]}},"required":["id","title","kind","points"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"grade":{"type":"object","description":"The mark: score out of points; null score when excused without one","properties":{"score":{"type":["number","null"]},"points":{"type":["number","null"]},"status":{"type":"string","enum":["draft","submitted","graded"]},"excused":{"type":"boolean"}},"required":["score","points","status","excused"],"additionalProperties":false},"gradedBy":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"source":{"type":"string","enum":["teacher","excuse","import"]}},"required":["submission","activity","course","student","grade","gradedBy","source"],"additionalProperties":false}
```

#### `quiz.completed`

**Quiz completed.** A student submitted a quiz attempt; it was marked automatically.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"submission":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"attempt":{"type":["integer","null"]}},"required":["id","attempt"],"additionalProperties":false},"activity":{"type":"object","description":"The activity (assignment, quiz or offline work)","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"kind":{"type":"string","enum":["assignment","quiz","offline"]},"points":{"type":["number","null"]}},"required":["id","title","kind","points"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"grade":{"type":"object","description":"The mark: score out of points; null score when excused without one","properties":{"score":{"type":["number","null"]},"points":{"type":["number","null"]},"status":{"type":"string","enum":["draft","submitted","graded"]},"excused":{"type":"boolean"}},"required":["score","points","status","excused"],"additionalProperties":false}},"required":["submission","activity","course","student","grade"],"additionalProperties":false}
```

### Attendance

#### `attendance.session_opened`

**Attendance opened.** A teacher opened an attendance session in a course.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"session":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":["string","null"]},"openedAt":{"type":"string","format":"date-time"},"closesAt":{"type":"string","format":"date-time"},"requiresCode":{"type":"boolean"},"lateAfterMinutes":{"type":["integer","null"]}},"required":["id","title","openedAt","closesAt","requiresCode","lateAfterMinutes"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"openedBy":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["session","course","openedBy"],"additionalProperties":false}
```

#### `attendance.session_closed`

**Attendance closed.** An attendance session closed (early, or when its time ran out). Everyone who had not checked in was marked absent; the counts include them.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"session":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":["string","null"]},"openedAt":{"type":"string","format":"date-time"},"closedAt":{"type":"string","format":"date-time"}},"required":["id","title","openedAt","closedAt"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"counts":{"type":"object","properties":{"present":{"type":"integer"},"late":{"type":"integer"},"absent":{"type":"integer"},"excused":{"type":"integer"}},"required":["present","late","absent","excused"],"additionalProperties":false}},"required":["session","course","counts"],"additionalProperties":false}
```

#### `attendance.recorded`

**Attendance recorded.** A student checked in (code or QR), or a teacher set or changed a student's attendance. Absences filled in automatically at close are in attendance.session_closed's counts, not sent one by one.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"session":{"type":"object","properties":{"id":{"type":"string","format":"uuid"}},"required":["id"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"record":{"type":"object","properties":{"status":{"type":"string","enum":["present","late","absent","excused"]},"method":{"type":"string","enum":["self","qr","teacher","auto"]},"checkedInAt":{"type":["string","null"],"format":"date-time"}},"required":["status","method","checkedInAt"],"additionalProperties":false},"recordedBy":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["session","course","student","record","recordedBy"],"additionalProperties":false}
```

### People & enrolment

#### `student.joined_school`

**Student joined the school.** A student joined the school with its join code or a student email domain.

Example `data`:

```json
{
  "student": {
    "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
    "firstName": "Ada",
    "lastName": "Lovelace",
    "email": "ada@students.riverside.edu"
  },
  "via": "join_code"
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"via":{"type":"string","enum":["join_code","email_domain"]}},"required":["student","via"],"additionalProperties":false}
```

#### `student.left_school`

**Student marked inactive.** A school admin marked a student inactive (the student has left). Students have no other way to leave a school; their record and marks stay.

Example `data`:

```json
{
  "student": {
    "id": "6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c",
    "firstName": "Ada",
    "lastName": "Lovelace",
    "email": "ada@students.riverside.edu"
  },
  "via": "marked_inactive"
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"via":{"type":"string","enum":["marked_inactive"]}},"required":["student","via"],"additionalProperties":false}
```

#### `student.enrolled`

**Student enrolled in a course.** A student was added to a course by its staff, or joined it with the course's code.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"via":{"type":"string","enum":["staff","join_code"]}},"required":["student","course","via"],"additionalProperties":false}
```

#### `student.unenrolled`

**Student removed from a course.** A student was removed from a course. `dropped` is true when they had work in it (kept, marked dropped), false when the enrolment was deleted.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"student":{"type":"object","description":"The student (student record id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"dropped":{"type":"boolean"}},"required":["student","course","dropped"],"additionalProperties":false}
```

#### `staff.joined`

**Staff member joined.** A school admin approved a join request, or a staff member joined with a staff email domain.

Example `data`:

```json
{
  "staff": {
    "id": "2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b",
    "firstName": "Grace",
    "lastName": "Hopper",
    "email": "g.hopper@riverside.edu"
  },
  "role": "teacher",
  "via": "join_request"
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"staff":{"type":"object","description":"A staff member (user profile id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"role":{"type":["string","null"],"enum":["admin","teacher","member",null]},"via":{"type":"string","enum":["join_request","email_domain"]}},"required":["staff","role","via"],"additionalProperties":false}
```

#### `staff.left`

**Staff member left.** A staff member left the school, or a school admin removed them.

Example `data`:

```json
{
  "staff": {
    "id": "2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b",
    "firstName": "Grace",
    "lastName": "Hopper",
    "email": "g.hopper@riverside.edu"
  },
  "via": "removed"
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"staff":{"type":"object","description":"A staff member (user profile id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"via":{"type":"string","enum":["left","removed"]}},"required":["staff","via"],"additionalProperties":false}
```

#### `staff.role_changed`

**Staff member's role changed.** A school admin changed a staff member's base role (admin, teacher, member). Custom role grants are not sent.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"staff":{"type":"object","description":"A staff member (user profile id)","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false},"role":{"type":"object","properties":{"before":{"type":["string","null"],"enum":["admin","teacher","member",null]},"after":{"type":["string","null"],"enum":["admin","teacher","member",null]}},"required":["before","after"],"additionalProperties":false}},"required":["staff","role"],"additionalProperties":false}
```

### Courses & content

#### `course.created`

**Course created.** A course was created (from scratch or as a copy).

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"createdBy":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["course","createdBy"],"additionalProperties":false}
```

#### `course.archived`

**Course archived.** A course was archived.

Example `data`:

```json
{
  "course": {
    "id": "9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f",
    "name": "Year 10 Mathematics",
    "code": "MATH10"
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false}},"required":["course"],"additionalProperties":false}
```

#### `activity.published`

**Activity published.** An assignment, quiz or offline activity was published (or reopened) to students.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"activity":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"kind":{"type":"string","enum":["assignment","quiz","offline"]},"points":{"type":["number","null"]},"dueAt":{"type":["string","null"],"format":"date-time"}},"required":["id","title","kind","points","dueAt"],"additionalProperties":false},"course":{"type":"object","description":"The course","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false}},"required":["activity","course"],"additionalProperties":false}
```

#### `announcement.posted`

**Announcement posted.** A school-wide or course announcement was posted. Only the title is sent, never the body.

Example `data`:

```json
{
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
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"announcement":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string"},"scope":{"type":"string","enum":["school","course"]}},"required":["id","title","scope"],"additionalProperties":false},"course":{"type":["object","null"],"description":"The course, for a course announcement","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"},"code":{"type":["string","null"]}},"required":["id","name","code"],"additionalProperties":false},"author":{"type":["object","null"],"description":"A staff member (user profile id), or null","properties":{"id":{"type":"string","format":"uuid"},"firstName":{"type":["string","null"]},"lastName":{"type":["string","null"]},"email":{"type":["string","null"]}},"required":["id","firstName","lastName","email"],"additionalProperties":false}},"required":["announcement","course","author"],"additionalProperties":false}
```

### System

#### `ping`

**Test (ping).** Sent by the Test button, to check the URL and your signature verification. Always delivered to the webhook being tested, whatever it subscribes to.

Example `data`:

```json
{
  "message": "Test delivery from GradeBook",
  "webhook": {
    "id": "0a2c4e6f-8b1d-4f3a-9c5e-6d8f0a2b4c7d",
    "name": "Student information system"
  }
}
```

Schema of `data` (JSON Schema draft 2020-12):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"message":{"type":"string"},"webhook":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":false}},"required":["message","webhook"],"additionalProperties":false}
```

