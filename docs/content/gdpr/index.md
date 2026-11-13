---
sidebar_label: GDPR preparation
sidebar_position: 1
---

# GDPR preparation for a GradeBook deployment

GradeBook provides technical features that can support data protection work,
including a public privacy notice, data exports, erasure workflows, retention
controls, access permissions, audit logs and MFA. Installing or configuring the
software does not by itself make an organisation compliant. Each school and
deployment owner must document its own purposes, lawful bases, responsibilities,
recipients, retention periods and safeguards, and check the requirements that
apply in its jurisdiction.

Use this page as a working pack with your data protection officer (DPO) or
privacy adviser. It is a starting point, not a completed legal assessment.

The pack has these parts:

- this page: before go-live, the processing record, DPIA screening and
  breach basics;
- [Data inventory](./data-inventory.md): every table holding personal data,
  with its categories, retention, erasure path and export coverage;
- [Sub-processors](./sub-processors.md): every provider the privacy notice
  can list, what it receives and what to check;
- [Incident response](./incident-response.md): triage, logs, affected people,
  notification and key rotation;
- [Cookies and device storage](./cookies.md);
- for staff: [Answering data requests](../guide/data-requests.md) and
  [Two-step verification](../guide/two-factor.md);
- for operators: [Hosting requirements](../hosting-requirements.md) (database
  TLS, encryption at rest, regions, staff MFA) and
  [Backups & GDPR](../backups.md).

## Before go-live

- Identify who acts as controller for each use of GradeBook. The organisation
  and individual schools may have different roles depending on their legal
  responsibilities and decisions about the data.
- Complete the organisation's privacy settings in **Organisation → Privacy**.
  The public notice reports missing required details, but the organisation must
  confirm that its content accurately describes real processing.
- Review the live provider list in the notice and add any recipients that the
  installation or schools use outside GradeBook's configuration.
- Record each purpose and lawful basis. For special-category data, record the
  applicable Article 9 condition and any required supporting policy document.
- Agree and document controller/processor responsibilities and data processing
  terms with schools and service providers as applicable.
- Set retention values to match approved schedules. Include database rows,
  object storage, exports, logs, backups, provider-side retention and old object
  versions. See [Backups & GDPR](../backups.md).
- The default audit history retention is two years. Confirm that period against
  the controller's approved schedule and set `AUDIT_LOG_RETENTION_DAYS` if it
  differs. This keeps the audit event after a file or record is deleted; it
  does not extend retention of the deleted file or record itself.
- Complete the processing record and DPIA screening below. A full DPIA should
  be completed before processing that is likely to result in high risk.
- Test data access, export, correction, restriction, deletion, backup restore
  and breach-response procedures before relying on them operationally.
- Name a person or team to receive rights requests and security incidents, and
  make sure they can reach the right decision-maker promptly.

### Controls that need an operator decision

These controls exist in GradeBook, but the running deployment must be checked
and configured. Record the owner, decision, date and evidence for each one.

| Control | Where it is enforced | Deployment action |
| --- | --- | --- |
| Require authenticator-app MFA for organisation admins, school admins and safeguarding roles | **Organisation → Settings → Two-step verification**; on by default. It is checked only when a session starts: a covered user with an app is asked for its code at each new sign-in (emailed code or single sign-on); a covered user without one who signs in with an emailed code can only set one up; a covered user without one who signs in with single sign-on is **not** stopped and relies on the identity provider's MFA. Sessions open before the setting (or the role) changed continue until they end. Step-up prompts use an emailed code. See [Two-step verification](../guide/two-factor.md). | Check privileged accounts are enrolled, enforce MFA at the identity provider for single sign-on, sign out existing sessions after turning the policy on, and review any exception. |
| Student leaver and closed-year retention | **Dashboard → Settings → Student-record retention**; erasure runs only after a schedule is set and the due list is confirmed | Approve periods against the school's retention duties, configure every school, review the due list, and confirm. These schedules are off until configured. |
| Soft-deleted content, audit history, exports and backups | Deployment environment and the scheduled retention jobs | Confirm the values in the live environment and include backups, object versions and provider-side copies in the schedule. The two-year audit setting retains event metadata after deletion, not deleted content. |
| Privacy notice and recipient list | **Organisation → Privacy** plus the public `/privacy` page | Confirm controller details, purposes and lawful bases; compare generated recipients with actual suppliers and integrations. The generated list is only as complete as the configuration GradeBook can see. |
| Access to student, pastoral and export data | School permissions, explicit safeguarding grants, MFA policy and audited routes | Review staff and custom-role assignments, remove leavers promptly, and ensure export rights are limited to staff with a documented need. |
| Database isolation | API authorization over a shared Postgres role | Treat API authorization as the enforcement boundary: this deployment does not use Postgres row-level security. Restrict database credentials and direct database access to the service and named operators. |

Access logging is also selective. GradeBook records reads of the student roster,
student records and profiles, gradebooks, attendance, at-risk analytics,
report releases, and pastoral records. It does not record every read endpoint;
the access review should treat these logs as evidence for those routes, not as a
complete record of every employee access.

The privacy notice marks suggested lawful-basis defaults as unconfirmed until
the organisation saves a choice for that purpose. The organisation remains
responsible for selecting a basis that matches its actual purpose and role.

### Evidence to retain

Keep a restricted operational record alongside the live configuration:

- approved Article 30 processing inventory, lawful-basis decisions, DPIA
  screenings and completed assessments;
- supplier register with service, purpose, data sent, hosting location,
  transfer mechanism, contract/DPA status, owner and next review date;
- dated access reviews, role changes, MFA enrollment exceptions and follow-up;
- retention decisions by record category, school configuration and periodic
  review of due/erased records;
- rights-request and incident registers, with decision records and closure
  evidence; and
- backup restore and erasure-replay exercise results.

Review these records when a provider, feature, data flow, retention rule,
deployment region or access role changes, and on a regular schedule set by the
organisation.

## Processing inventory and Article 30 record

Maintain one record for each distinct purpose or processing activity. The
following inventory is a prompt based on GradeBook's features; remove anything
not used, and add school-specific systems and processes. It is not a substitute
for the controller's own record.

| Activity | People | Data to review | Typical recipients or systems | Decisions to record |
| --- | --- | --- | --- | --- |
| Accounts and access | Students, parents/guardians, staff | Names, contact details, account identifiers, roles, sign-in and session data | Email, identity provider, hosting and database providers | Account lifecycle, lawful basis, MFA and session rules |
| Teaching and assessment | Students, staff | Course content, submissions, quiz answers, marks, feedback and reports | Hosting, database, file storage; AI provider only when enabled and used | Retention, AI use, opt-outs, human review and access roles |
| Attendance and location checks | Students, staff | Attendance status and times; transient location coordinates if a location check is used | Hosting, database, push provider if alerts are enabled | Whether location is necessary, when coordinates are cleared, alert recipients |
| Parent portal and communication | Students, parents/guardians, staff | Family links, messages, announcements, notification settings | Email and push services, hosting | Link verification, what parents can access, notification content |
| Pastoral and safeguarding | Students, staff | Sensitive notes, follow-ups, attachments and access history | Restricted database and file storage | Article 9 condition, designated access, access logging, retention and disclosure exceptions |
| Rostering and integrations | Students, parents/guardians, staff | Identifiers, names, classes, enrolments, selected event data | School MIS, SSO/identity providers, LTI tools and configured webhooks | Data fields shared, transfer safeguards, contracts and deletion on disconnect |
| Security, audit and support | Users, staff | Sign-in events, security events, record changes, support and diagnostic data | Hosting, monitoring and email providers | Access, retention, breach escalation and whether diagnostics contain personal data |

For each record, complete the following controller-specific fields:

| Record field | Complete for this deployment |
| --- | --- |
| Controller and any joint controllers | Legal names, addresses, responsibilities and contact details |
| DPO or privacy contact | Name or role, contact details, and how data subjects reach them |
| Purpose and lawful basis | Specific purpose, Article 6 basis, and Article 9 condition where relevant |
| People and data categories | Include children, special-category data, identifiers and inferred data |
| Recipients | Processors, independent controllers, school systems and disclosures |
| International transfers | Destination, transfer mechanism, assessment and supplementary measures |
| Retention | Period or criteria for each system, including backups and logs |
| Security | Technical and organisational measures, access roles and encryption boundaries |
| Rights and restrictions | How requests are received, verified, fulfilled, withheld or escalated |
| Review | Owner, approval date, next review date and change history |

The notice's provider list is generated from the installation's current
configuration. Compare it with contracts, infrastructure, school integrations
and actual use; a configured provider list alone is not proof that all flows
have been captured.

## DPIA screening and template

The controller should screen each new or changed processing activity for risk.
A DPIA is required before processing where it is likely to result in a high
risk to people's rights and freedoms. Processing children's information,
sensitive pastoral or health-related information, systematic monitoring,
large-scale data use, or combining data from multiple sources are reasons to
consider a full assessment. The controller must make and document the decision
using the applicable supervisory authority's criteria.

Copy and complete this template for each activity that needs assessment:

1. **Scope and ownership:** activity, systems, controller(s), DPO/adviser,
   approver, date, version and planned review date.
2. **Purpose and necessity:** intended outcomes, people affected, data fields,
   sources, recipients, retention, lawful basis, Article 9 condition if needed,
   and why a less intrusive method would not achieve the purpose.
3. **Data flow:** collection, use, access, disclosures, transfers, storage,
   backup, deletion and restore. Attach a flow diagram where helpful.
4. **People's expectations and rights:** explain notices, choices, access,
   correction, objection/restriction and deletion routes; account for children's
   age and understanding, safeguarding constraints and unequal power.
5. **Risk assessment:** for each risk, record its cause, affected people,
   likelihood, severity, existing safeguards, residual risk and owner. Consider
   confidentiality, integrity, availability, discrimination, loss of control,
   identity theft, distress and safeguarding harm.
6. **Measures and actions:** list technical and organisational measures,
   actions, owners, deadlines and evidence. Include access controls, audit,
   encryption, minimisation, retention, staff training, supplier terms and
   breach response where relevant.
7. **Consultation:** record advice from the DPO/privacy adviser, affected
   people or representatives where appropriate, school safeguarding leads and
   processors. Record why consultation was not appropriate if omitted.
8. **Decision:** document whether residual risk is acceptable, who approved it,
   conditions for approval, and whether the supervisory authority must be
   consulted before processing because high residual risk remains.

Revisit the assessment when purposes, data, recipients, technology, scale,
people affected or safeguards materially change, and after a relevant incident.

## Personal data breach response

The step-by-step runbook, with the logs to pull and a breach register
template, is [Incident response](./incident-response.md). The summary:

The controller remains responsible for deciding whether to notify the
supervisory authority or affected people. A processor should notify its
controller without undue delay after becoming aware of a personal data breach.
Under GDPR Article 33, the controller notifies the competent supervisory
authority without undue delay and, where feasible, within 72 hours of becoming
aware, unless the breach is unlikely to result in a risk to people's rights and
freedoms. If notification is late, the controller explains the delay. A
high-risk breach may also require communication to affected people without
undue delay. Record every breach, including the assessment and reasons for not
notifying.

### Response checklist

1. **Report and preserve:** record who discovered the event and when; preserve
   relevant logs and evidence; notify the incident lead, DPO/privacy contact,
   security lead and affected controller(s).
2. **Contain:** revoke exposed credentials and sessions, restrict access,
   disable affected integrations or endpoints, recover exposed data where
   possible, and protect people at immediate risk. Preserve evidence before
   making changes that could destroy it.
3. **Assess:** identify what happened, the systems and data involved, number
   and categories of people and records, likely consequences, whether children
   or sensitive data are involved, and whether data was encrypted and the key
   remained protected. Keep updating the assessment as facts emerge.
4. **Decide and notify:** the controller documents the risk decision and
   whether authority notification and communication to people are required.
   Start the 72-hour assessment promptly; provide information in stages if
   needed rather than waiting for every fact.
5. **Remediate and learn:** restore safely, rotate affected secrets, address
   root causes, update the risk register and DPIA, and track corrective actions.

### Incident record

Record the discovery time and reporter; timeline; nature and cause; systems;
data categories; approximate number of people and records; effects and risks;
containment and recovery steps; encryption/key status; controller and processor
contacts; DPO advice; notification decisions, recipients and timestamps; reasons
for decisions; and preventive actions with owners and due dates. Store this
record with restricted access and according to an approved retention schedule.

## References

- [GDPR text, including Articles 28, 30, 33, 34 and 35](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)
- [ICO: 72 hours - how to respond to a personal data breach](https://ico.org.uk/for-organisations/advice-for-small-organisations/personal-data-breaches/72-hours-how-to-respond-to-a-personal-data-breach)
- [ICO: breach response and monitoring](https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/toolkits/accountability/breach-response-and-monitoring/)
- [GradeBook backup and restore guidance](../backups.md)
