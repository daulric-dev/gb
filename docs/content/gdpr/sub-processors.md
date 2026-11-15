---
sidebar_label: Sub-processors
sidebar_position: 3
---

# Sub-processors and other recipients

The privacy notice (`/privacy`) lists recipients generated from the live
configuration (`backend/src/privacy/privacy.recipients.ts`). This page lists
every kind of provider that list can contain, what GradeBook sends it, where
to look for where it processes data, what to check before relying on it, and
how to stop the flow.

Use it to build and review your supplier register. For each provider you
actually use, record: the legal entity, the service and plan, the region you
chose, the contract and data processing agreement (GDPR Article 28), the
transfer mechanism if data leaves the UK/EEA, the owner, and the next review
date.

**What "check" means below.** Before use, confirm for each provider:

1. **DPA**: a data processing agreement covering Article 28(3) is signed or
   accepted, and lists its own sub-processors.
2. **Location**: where the data is stored and processed for the plan and
   region you chose, including support access.
3. **Transfers**: if data leaves the UK/EEA to a country without an adequacy
   decision, the mechanism: EU Standard Contractual Clauses (SCCs) or the UK
   IDTA / Addendum, or, for US providers, current certification under the
   EU-US Data Privacy Framework (DPF) and the UK extension. Record a transfer
   risk assessment where SCCs are used.
4. **Retention**: how long the provider keeps the data (logs, backups) and
   whether it uses it for its own purposes (for example, model training).

This page does not state any provider's current contract terms: they change.
Check them yourself and keep the evidence.

## What the generated list does not show

The list covers only what GradeBook can see in its configuration. Add the
rest by hand under **Organisation → Privacy → Recipients** (they then
appear in the notice as hosting providers):

- the **server or cloud host** running the API, frontend and proxy;
- the **PostgreSQL provider** (`DATABASE_URL` is not listed automatically);
- a **managed Redis** provider (cache contents include session lookups and
  translated text);
- a **CDN or proxy in front of** Caddy (Cloudflare and similar) - it sees all
  traffic;
- monitoring, log or error-tracking services you add;
- the identity provider of a school that signs in through an install-wide
  app but is not otherwise configured;
- the backup bucket, when the API's environment does not contain the
  `BACKUP_S3_*` / `WALG_S3_*` variables (for example a PM2 deployment where
  backups run elsewhere).

## Providers by category

### Email delivery (always on)

| | |
| --- | --- |
| Listed when | `SMTP_URL`, `SMTP_HOST` or `SMTP_SERVICE` is set. Known hosts are named (Amazon SES, Google Workspace, Microsoft Exchange Online, Yahoo, Apple iCloud, Zoho, SendGrid, Mailgun, Postmark, Brevo, Mailjet, SparkPost, Resend); others show their host. |
| Data sent | Recipient address, subject and body of sign-in codes, invitations, alerts, notices to parents and staff, data-export-ready emails, security emails (new sign-in, two-step changes). Bodies can name a child and what happened (for example an absence). |
| Where | The provider's region for your account. |
| Check | DPA, location, transfers, and how long the provider keeps message content and logs. |
| Turn off | Cannot: email-code sign-in needs it. Choose an EU-region provider, or your own mail server. Parents and staff can turn individual notices off. |

### File storage (always on)

| | |
| --- | --- |
| Listed when | `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` or `S3_BUCKET` is set: AWS S3 (region from `S3_REGION`), Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Wasabi, Scaleway, OVHcloud, Hetzner, Google Cloud Storage, Microsoft Azure, or the endpoint host. A host on your own network is shown as "the organisation's own server". |
| Data sent | Every uploaded file: submissions, course files, profile pictures, school logos, pastoral note attachments, report card PDFs, data exports, the erasure-log copy. Stored as uploaded: GradeBook does not encrypt these itself. |
| Where | The bucket's region. |
| Check | DPA, location, transfers, server-side encryption on, versioning and lifecycle rules consistent with your retention. |
| Turn off | Cannot. Self-host (MinIO, SeaweedFS) to keep it in-house. |

`S3_PUBLIC_URL` (a CDN or public bucket host) is listed separately: it
serves profile pictures and school logos to browsers. Unset it to serve them
through the API instead.

### Database backups (required in production)

| | |
| --- | --- |
| Listed when | `BACKUP_S3_BUCKET` (daily dumps) or `WALG_S3_PREFIX` (continuous archiving) is set in the API's environment. |
| Data sent | The whole database, **encrypted before upload** (age, or libsodium for WAL-G). The provider cannot read it without the private key you keep offline. |
| Where | `BACKUP_S3_REGION` / `WALG_S3_REGION`; both have no default so you choose. |
| Check | DPA, location, Object Lock and version expiry consistent with the backup retention stated in the notice. |
| Turn off | Do not: backups are required in production. |

### Push notifications (feature `push_notifications`)

| | |
| --- | --- |
| Listed when | The organisation has push notifications on. Three recipients: Expo (the push relay), Apple Push Notification service (iPhone), Google Firebase Cloud Messaging (Android). |
| Data sent | The device's push token, and the notification title, text and data. By default, notifications about a child (grades, attendance, parent notices, discussion replies) are sent as "You have a new update" with only ids, and course news (new work, announcements) is sent in full. The school or the organisation can make everything generic or everything full. |
| Where | Expo, Apple and Google operate globally; check each one's terms for your account. |
| Check | DPA and transfer mechanism for Expo; Apple's and Google's terms for their push services. |
| Turn off | Switch the `push_notifications` feature off (Organisation → Features), or set notification content to generic (Organisation → Settings, or a school's settings). Users can turn categories off. |

### Single sign-on (per school or install-wide)

| | |
| --- | --- |
| Listed when | `SSO_PROVIDERS` names `google` or `azure`; a school saved and enabled a Google, Microsoft or OpenID Connect app (the issuer is listed); or an email domain signs in with SAML (its entry point is listed). |
| Data sent | A sign-in request; the provider returns the person's identifier, name and email. The provider also learns when the person signs in to GradeBook. |
| Where | The identity provider's region (usually the school's existing Google Workspace or Microsoft 365 tenant). |
| Check | The school usually already has a contract with this provider for its own accounts; confirm it covers this use. Enforce MFA there for staff. |
| Turn off | Remove the school's app (school **Single sign-on** settings), the SAML setting on the email domain, or `SSO_PROVIDERS`. |

### AI assistance (feature `ai_assistance`, off by default)

| | |
| --- | --- |
| Listed when | The feature is on; one recipient per configured AI provider (Anthropic by default for that kind; otherwise the base URL: OpenAI, Azure OpenAI, Mistral AI, Google Gemini API, OpenRouter, Groq, or the host). A local model server on your own network is shown as "the organisation's own server". |
| Data sent | Staff prompts and the course material they choose (plans, questions, pages). Student work only for rubric feedback suggestions, only where the school turned **Allow sending student work to the AI provider**
on (off by default; files are never sent), never for a student with **No AI processing**. Before sending, the student's and classmates' names, email addresses and phone-like numbers are replaced with placeholders. |
| Where | The provider's region for your account or deployment. |
| Check | DPA, location, transfers, whether the provider trains on API data and how long it keeps prompts. GradeBook keeps prompts only if the organisation turns on keeping them (30 days). |
| Turn off | Switch the feature off for the organisation or a school, remove the provider, keep the school's student-work switch off, or set **No AI processing** on a student. |

### Translation (feature `translation`, off by default)

| | |
| --- | --- |
| Listed when | The feature is on and the organisation's translation settings are enabled. |
| Data sent | The visible interface text and course content of the page a person is viewing, after they chose a language. Not sent: form inputs, pages about individual people (chat, pastoral notes, student records, analytics, audit logs) and text marked private (names, marks, grades, feedback, email addresses). Personal details written inside course content are sent with it. Teachers' translated copies send activity text only. |
| Where | **LibreTranslate**: the server you configure (self-hosted keeps it in-house; someone else's server is a processor). **DeepL**: DeepL SE, Germany. **Google** (unofficial endpoint, United States) and **Yandex** (Russia): no data processing agreement and no transfer mechanism is available. |
| Check | LibreTranslate run by a third party, or DeepL: DPA (for DeepL, an API Pro plan; the Free API's terms let DeepL use texts). Google and Yandex are refused unless the server sets `TRANSLATION_ALLOW_UNCONTRACTED_ENGINES=true`; do not set it for personal data without your own transfer assessment. |
| Turn off | Switch the feature off, disable the organisation's translation settings, or let a school switch it off. People can choose English again. |

### Webhooks (feature `integrations`, off by default)

| | |
| --- | --- |
| Listed when | The feature is on; one recipient per distinct enabled webhook URL. Internal addresses are shown as "the organisation's own server". |
| Data sent | The events the school subscribed to, for example grade or attendance changes: ids, people's names and email addresses, course and activity names, never pastoral notes, accommodation reasons or message bodies. |
| Where | Wherever the school's receiving system runs. |
| Check | Usually the school's own system or a supplier it contracts directly. New webhooks must use https unless the server sets `WEBHOOK_ALLOW_PRIVATE=true`; older http webhooks are marked unencrypted in the school's settings; certificate checking can be turned off per webhook (audited, admins emailed). Review those. |
| Turn off | The school disables or deletes the webhook, or switch the feature off. |

### External tools, LTI (feature `lti`, off by default)

| | |
| --- | --- |
| Listed when | The feature is on; one recipient per enabled tool. |
| Data sent | When someone opens the tool: a pseudonymous user id, role and course; name and email only if the organisation allowed that tool to receive them. The tool can send grades back. |
| Where | The tool vendor's hosting. |
| Check | DPA with each vendor (the school's or the organisation's), location, transfers; leave name and email off unless needed. |
| Turn off | Disable the tool, or switch the feature off. |

### Rostering (feature `rostering`, off by default)

| | |
| --- | --- |
| Listed when | The feature is on; one recipient per OneRoster API source (CSV uploads have none). |
| Data sent | GradeBook sends authentication requests; the source **sends GradeBook** students, staff, classes and enrolments. GradeBook does not send student data back. |
| Where | The school's information system vendor. |
| Check | The school's existing contract with its MIS vendor; that the API credentials are limited to what is needed. |
| Turn off | Delete the roster source, or switch the feature off. |

## Keeping this current

The generated list changes when configuration changes. Review it, and this
register, when you add a provider, enable a feature that sends data out,
change a region, or a provider changes its terms or sub-processors. Keep the
evidence (signed DPA, transfer assessment, settings screenshots) with the
register.
