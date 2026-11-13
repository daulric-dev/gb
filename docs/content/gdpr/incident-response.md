---
sidebar_label: Incident response
sidebar_position: 4
---

# Incident response runbook

What to do when personal data in GradeBook may have been lost, exposed,
changed or made unavailable. It complements the breach section of
[GDPR preparation](./index.md#personal-data-breach-response). The
controller (the organisation, and each school for its own records) decides
on notification; the operator gathers the facts.

Act quickly: some evidence ages out (expired sessions are deleted about a
day after they end, webhook deliveries after 30 days, container logs when
they rotate).

## 1. Triage (first hour)

1. **Open a breach register entry** (template at the end) with the time you
   became aware. The 72-hour clock in Article 33 starts when the controller
   is reasonably certain that a breach affecting personal data has happened.
2. **Name an incident lead** and tell the DPO or privacy contact, the
   organisation administrators and, if a school is affected, its
   administrator and safeguarding lead.
3. **Classify it**: confidentiality (seen by someone who should not have),
   integrity (changed), or availability (lost or unavailable, including
   ransomware and a failed restore). It can be more than one.
4. **Preserve evidence before changing things**: copy the logs below (section
   2) and, if a server may be compromised, snapshot it before rebuilding.
5. **Contain**, as far as it does not destroy evidence:
   - a compromised account: **Organisation → Admins** or the school page →
     **Sign out sessions** for an administrator, or
     `POST /api/organisation/users/:userId/sessions/revoke` for anyone (an
     organisation administrator); the person can also end sessions under
     **Signed-in devices**. Reset two-step verification if the phone is lost
     ([Two-step verification](../guide/two-factor.md)); remove roles
     the account should not have;
   - a leaked integration: disable the school's webhook, LTI tool or roster
     source; rotate its secret at both ends;
   - a leaked server secret: rotate it (section 6);
   - an exposed bucket or file: make it private, delete public links, rotate
     the storage keys;
   - everyone at once: changing `AUTH_SECRET` signs every user out (read
     section 6 first).

## 2. Logs to pull

Copy these for the time window, plus a margin, into restricted storage.

| Source | What it shows | Where / how |
| --- | --- | --- |
| `public.audit_log` | Changes to school records with before/after values (redacted), reads of student records, rosters, gradebooks, attendance, at-risk lists, report releases and pastoral notes, AI requests (no content), two-step verification events (`entity = 'user_mfa'`), data export requests and downloads (`entity = 'data_export'`), organisation settings. Actor id, name and email. Append-only. | **Organisation → Audit log**, a school's **Audit log**, or SQL. Kept `AUDIT_LOG_RETENTION_DAYS` (730). |
| `public.sso_audit_log` | Changes to sign-in configuration: email domains, SSO apps, SAML certificates (fingerprints only), who changed them. | SQL. |
| `public.integration_audit_log` | Webhook changes: created, URL changed, secret rotated, TLS verification turned off, auto-disabled. | SQL. |
| `public.webhook_delivery` | What was sent to which webhook and when, with the payload and whether the certificate was verified (`tls_verified`). | SQL. Kept `WEBHOOK_DELIVERY_RETENTION_DAYS` (30). |
| `account.session` | Each session: user, created, last used, `ip`, `user_agent`, `device`, sign-in `method`, revoked and why. | SQL. Deleted about a day after they expire or are revoked: copy early. |
| `account.known_device` | One-way device fingerprints per user, first and last seen. | SQL. 90 days unused. |
| `compliance.data_export` | Every export: who asked, about whom, when it was ready and downloaded. | SQL; the audit log has the matching `data_export` entries. Rows go 30 days after expiry. |
| `compliance.erasure_log` | Every erasure, by id: what, when, by whom, why. Also the copy in the bucket under `ERASURE_LOG_S3_PREFIX`. | SQL / storage. 400 days. |
| `public.ai_request` | Who sent what kind of request to which AI provider, and status; prompts only if kept. | SQL. One year. |
| `public.lti_launch` | Who opened which external tool and when. | SQL. |
| Caddy access log | Every HTTP request: time, client address, method, path, status, user agent. | `docker compose logs caddy` (stdout). Docker's default `json-file` driver keeps it until the container is removed or the logs rotate, if you configured rotation. PM2 deployments: the host Caddy's log and PM2's rotated logs. Copy it now. |
| API logs | Errors, warnings (for example "Wrong authenticator code", webhook failures). | `docker compose logs app1 app2 app3` or PM2 logs. |
| Provider logs | Storage access logs, database provider audit, SMTP provider logs, identity provider sign-in logs. | Each provider's console. Turn on bucket access logging before you need it. |

Useful queries (read-only; run on a replica or a restored copy where you
can):

```sql
-- Everything one account did, and was done to it, in a window
SELECT created_at, scope, school_name, actor_email, entity, entity_id, action, changes
FROM public.audit_log
WHERE (actor_id = :user OR entity_id = :user::text)
  AND created_at BETWEEN :from AND :to
ORDER BY created_at;

-- Sessions from a suspicious address, or for one user
SELECT user_id, created_at, last_seen_at, ip, user_agent, device, method, revoked_at, revoked_reason
FROM account.session
WHERE ip = :ip OR user_id = :user
ORDER BY created_at;

-- Whose records an account read (student records, notes, rosters, ...)
SELECT entity, entity_id, school_name, count(*), min(created_at), max(created_at)
FROM public.audit_log
WHERE actor_id = :user AND action = 'read' AND created_at BETWEEN :from AND :to
GROUP BY 1, 2, 3;

-- Data exports made or downloaded in the window
SELECT id, requested_by, kind, student_id, subject_user_id, school_id, created_at, completed_at, downloaded_at
FROM compliance.data_export
WHERE created_at BETWEEN :from AND :to;
```

Read access is logged only for the routes listed in
[GDPR preparation](./index.md#controls-that-need-an-operator-decision), not
for every page; say so when you assess scope.

## 3. Finding the people affected

Work out the **categories of data** and **who they are about**, and count
them. Typical cases:

- **One account misused**: the records it read or changed (audit log, above)
  and, if staff, the students in its courses and schools.
- **A role given too widely**: the members who held it
  (`public.school_management`, `public.school_management_role`) and the
  records those permissions expose in that school.
- **A file or bucket exposed**: the owners and subjects of the objects
  (`file_manager.file.storage_path` → `owner_id`, `school_id`; submissions
  link files to students through `grading.submission` and
  `grading.submission_file`; report PDFs are `grading.report_document`;
  exports are `compliance.data_export`).
- **A webhook or tool leak**: the deliveries in `public.webhook_delivery` for
  that webhook (payloads name the people), or `public.lti_launch` for the
  tool.
- **A database copy exposed**: everyone in it. Chat messages, pastoral note
  text, accommodation reasons, authenticator secrets and stored credentials
  are encrypted with keys held outside the database (`CHAT_ENCRYPTION_KEY`,
  `DATA_ENCRYPTION_KEY`); everything else is readable. If those keys may also
  have leaked, treat those fields as exposed too.
- **An encrypted backup exposed**: low risk while the age private key (and
  `WALG_LIBSODIUM_KEY`) stayed offline. Record why you concluded that.

Note whether children, special-category data (pastoral and safeguarding
notes, accommodation reasons, medical-related categories) or location data
are involved: they raise the risk.

## 4. Notifying the supervisory authority (Article 33)

Notify the competent supervisory authority **without undue delay and, where
feasible, within 72 hours** of becoming aware, **unless** the breach is
unlikely to result in a risk to people's rights and freedoms. A processor
tells the controller without undue delay. If you cannot give everything in
72 hours, notify with what you have and add the rest in phases; if you
notify late, give the reasons.

The notice must at least:

- describe the nature of the breach, the categories and approximate number of
  people and of records;
- give the DPO's or contact point's name and contact details;
- describe the likely consequences;
- describe the measures taken or proposed, including to reduce harm.

Record the decision either way, with the reasons, in the register.

## 5. Telling the people affected (Article 34)

When the breach is likely to result in a **high risk** to people, tell them
without undue delay, in clear and plain language suited to their age (for
children, usually through parents as well), with: what happened, the likely
consequences, what you did and are doing, what they can do (for example, sign
out of other devices, watch for phishing), and who to contact.

You need not tell them individually if the data was protected so it is
unintelligible (for example, encrypted with keys that were not exposed), if
later measures mean the high risk is no longer likely, or if it would involve
disproportionate effort (then make a public communication instead). The
authority can still require it.

For safeguarding information, involve the designated safeguarding lead before
contacting families.

## 6. Rotating keys and secrets

Do this once the evidence is preserved. Which keys matter:

| Secret | Protects | Rotating it |
| --- | --- | --- |
| `AUTH_SECRET` | Hashes of sign-in codes and session tokens; signs short-lived tokens. Also keys any stored secret still written as `v1:` (from before `DATA_ENCRYPTION_KEY` was set) and older erasure-log signatures. | Changing it **signs everyone out** and voids outstanding codes. First make sure nothing still depends on it (below). |
| `DATA_ENCRYPTION_KEY` | Stored credentials (webhook secrets and headers, SSO client secrets, AI provider, translation and roster source keys, the LTI platform key), authenticator-app secrets, pastoral note text, accommodation reasons; signs new erasure-log copies. | **No supported rotation**: there is one key and no key ring, so a new value makes everything written under the old one unreadable. If it leaked, rotate the credentials it protects at their source (webhook secrets, SSO client secrets, AI and translation keys, roster credentials) and treat the encrypted student text as exposed for any database copy that also leaked. |
| `CHAT_ENCRYPTION_KEY` / `CHAT_ENCRYPTION_KEYS` | Chat message bodies. | Add a new key to the ring (`CHAT_ENCRYPTION_KEYS=1:<old>,2:<new>`); new messages use the highest version (or `CHAT_ENCRYPTION_KEY_VERSION`). Existing messages stay under their old key, which must stay in the ring to read them: there is no re-encryption tool, so rotation protects new messages only. |
| `STUDENT_CLAIM_CODE_PEPPER` | Hashes of school join codes. | Changing it invalidates unredeemed codes; schools issue new ones. |
| Others | SMTP password, S3 and backup bucket keys, `REDIS_PASSWORD`, OAuth client secrets, `EXPO_ACCESS_TOKEN`, the age backup key pair, `WALG_LIBSODIUM_KEY`. | Rotate at the provider and update `.env`; restart. A new age key pair protects new backups only. |

### Rotating `AUTH_SECRET` safely

1. Make sure `DATA_ENCRYPTION_KEY` is set on every API instance (production
   refuses to start without it).
2. With the **current** `AUTH_SECRET` still set, run in `backend/`:

   ```sh
   bun run secrets:reencrypt --dry-run
   bun run secrets:reencrypt
   ```

   It moves webhook secrets and header values, SSO client secrets, pastoral
   note text, accommodation reasons and the erasure-log signatures onto
   `DATA_ENCRYPTION_KEY`, and exits 0 only when none of those is left on
   `AUTH_SECRET`. With a write-once erasure-log bucket add
   `--skip-erasure-log` (see [Environment variables](../environment-variables.md)).
3. It does **not** yet move authenticator-app secrets, AI provider keys, the
   translation key, roster source secrets or the LTI platform key. Check none
   is still on `AUTH_SECRET`:

   ```sql
   SELECT 'mfa_totp', count(*) FROM account.mfa_totp
     WHERE secret_enc LIKE 'v1:%' OR pending_secret_enc LIKE 'v1:%'
   UNION ALL SELECT 'ai_provider', count(*) FROM public.ai_provider WHERE api_key_enc LIKE 'v1:%'
   UNION ALL SELECT 'translation_setting', count(*) FROM public.translation_setting WHERE key_enc LIKE 'v1:%'
   UNION ALL SELECT 'roster_source', count(*) FROM public.roster_source WHERE client_secret_enc LIKE 'v1:%'
   UNION ALL SELECT 'lti_platform_key', count(*) FROM public.lti_platform_key WHERE private_key_sealed LIKE 'v1:%';
   ```

   Any non-zero count: re-enter those keys in the organisation console after
   the rotation, and reset two-step verification for the users listed in
   `account.mfa_totp` (or ask them to set it up again first).
4. Change `AUTH_SECRET` on every instance and restart. Everyone signs in
   again.

## 7. Recover and learn

- Restore from backup if data was lost or corrupted, then run
  `bun run erasure:replay --since <backup time>` so erasures made after the
  backup are applied again ([Backups & GDPR](../backups.md)).
- Fix the cause, review roles and the settings involved, update the DPIA and
  risk register, and record the actions with owners and dates.

## Breach register template

Keep one entry per incident, including those you decide not to notify.
Store the register with restricted access.

| Field | Entry |
| --- | --- |
| Reference | |
| Discovered (date, time, by whom, how) | |
| Became aware (controller), and the 72-hour deadline | |
| Incident lead; DPO / privacy contact consulted | |
| Controller(s) and processor(s) involved | |
| What happened (nature and cause); timeline | |
| Type: confidentiality / integrity / availability | |
| Systems and data categories | |
| Special-category, children's or location data involved? | |
| Approximate number of people; of records | |
| Encryption and key status (were keys exposed?) | |
| Likely consequences for people | |
| Containment and recovery steps, with times | |
| Evidence preserved (what, where) | |
| Risk assessment and decision on Article 33 notice, with reasons | |
| Authority notified (when, reference, phased updates) | |
| Decision on Article 34 communication, with reasons | |
| People told (when, how, text used) | |
| Keys and secrets rotated | |
| Root cause and corrective actions (owner, due date, done) | |
| Closed (date, by whom) | |
