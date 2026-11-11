import type { Collector, ExportScope } from './data-export.types';
import { devicesCollector, identitiesCollector, profileCollector, sessionsCollector } from './collectors/account';
import { membershipsCollector } from './collectors/memberships';
import { chatCollector, discussionsCollector, notificationsCollector } from './collectors/communication';
import { filesCollector } from './collectors/files';
import { courseworkCollector, masteryCollector } from './collectors/coursework';
import { attendanceCollector } from './collectors/attendance';
import { reportsCollector } from './collectors/reports';
import { pastoralCollector, staffRecordsCollector } from './collectors/staff-only';
import { aiCollector, auditCollector, integrationsCollector } from './collectors/activity';

/**
 * Every category an export can contain, in README order. Each collector
 * names the person columns it covers; registry.test.ts fails when a person
 * column in the Prisma schema is neither covered here nor in EXCLUDED.
 */
export const COLLECTORS: readonly Collector[] = [
  profileCollector,
  identitiesCollector,
  sessionsCollector,
  devicesCollector,
  membershipsCollector,
  courseworkCollector,
  masteryCollector,
  attendanceCollector,
  reportsCollector,
  filesCollector,
  chatCollector,
  discussionsCollector,
  notificationsCollector,
  aiCollector,
  integrationsCollector,
  auditCollector,
  pastoralCollector,
  staffRecordsCollector,
];

const STAFF_ACTION =
  'Who on the staff did something to school content or another person\'s record. The record itself is exported with the person it is about; the staff member\'s own actions appear in their audit-log extract where the feature is audited.';
const SCHOOL_CONFIG =
  'Who last changed or created a school or organisation setting or shared resource (course content, scales, rubrics, tools, integrations). School data, not about the person; kept for accountability.';

/**
 * Person columns deliberately left out of every export, with the reason.
 * `schema.table.column` as in the database.
 */
export const EXCLUDED: Readonly<Record<string, string>> = {
  // Staff actions on students' records.
  'course.attendance_record.updated_by': STAFF_ACTION,
  'course.attendance_session.opened_by': STAFF_ACTION,
  'grading.submission.graded_by': STAFF_ACTION,
  'grading.quiz_answer.marked_by': STAFF_ACTION,
  'grading.activity_extension.created_by': STAFF_ACTION,
  'grading.activity_accommodation.created_by': STAFF_ACTION,
  'grading.student_accommodation.created_by': STAFF_ACTION,
  'grading.peer_review_allocation.hidden_by': STAFF_ACTION,
  'grading.report_comment.author_id': STAFF_ACTION,
  'grading.report_head_comment.author_id': STAFF_ACTION,
  'student.pastoral_note.author_id': STAFF_ACTION,
  'student.pastoral_note.assigned_to': STAFF_ACTION,
  'student.pastoral_note.resolved_by': STAFF_ACTION,
  'student.pastoral_note.sar_withheld_by': STAFF_ACTION,
  'student.attendance_alert.acknowledged_by': STAFF_ACTION,
  'student.parent_invite.created_by': STAFF_ACTION,
  'student.parent_student_link.created_by': STAFF_ACTION,
  'public.school_join_request.reviewed_by': STAFF_ACTION,
  'public.organisation_admin.created_by': STAFF_ACTION,
  'public.organisation_invite.invited_by':
    'An administrator inviting someone by email. The invitation belongs to the invitee and stops mattering once accepted; the resulting role is in memberships.',
  'public.organisation_invite.accepted_by':
    'The invitation the person accepted; the resulting administrator role is exported in memberships.',
  'student.parent_invite.used_by':
    'The invitation a parent redeemed; the resulting parent-child link is exported in memberships.',

  // School content and settings.
  'course.course.created_by': SCHOOL_CONFIG,
  'course.page.created_by': SCHOOL_CONFIG,
  'course.library_item.created_by': SCHOOL_CONFIG,
  'course.library_item_version.published_by': SCHOOL_CONFIG,
  'course.library_import.requested_by': SCHOOL_CONFIG,
  'course.timetable_entry.created_by': SCHOOL_CONFIG,
  'course.timetable_override.created_by': SCHOOL_CONFIG,
  'grading.activity.created_by': SCHOOL_CONFIG,
  'grading.grade_scale.created_by': SCHOOL_CONFIG,
  'grading.grade_scale.updated_by': SCHOOL_CONFIG,
  'grading.question_bank.created_by': SCHOOL_CONFIG,
  'grading.rubric.created_by': SCHOOL_CONFIG,
  'grading.outcome_set.created_by': SCHOOL_CONFIG,
  'grading.outcome.created_by': SCHOOL_CONFIG,
  'grading.outcome_alignment.created_by': SCHOOL_CONFIG,
  'grading.mastery_setting.updated_by': SCHOOL_CONFIG,
  'grading.similarity_setting.updated_by': SCHOOL_CONFIG,
  'grading.report_release.published_by': SCHOOL_CONFIG,
  'public.ai_provider.created_by': SCHOOL_CONFIG,
  'public.ai_org_setting.updated_by': SCHOOL_CONFIG,
  'public.ai_school_setting.updated_by': SCHOOL_CONFIG,
  'public.analytics_setting.updated_by': SCHOOL_CONFIG,
  'public.attendance_alert_setting.updated_by': SCHOOL_CONFIG,
  'public.timetable_setting.updated_by': SCHOOL_CONFIG,
  'public.school_closure.created_by': SCHOOL_CONFIG,
  'public.school_email_domain.created_by': SCHOOL_CONFIG,
  'public.school_sso_provider.updated_by': SCHOOL_CONFIG,
  'public.school_webhook.created_by': SCHOOL_CONFIG,
  'public.lti_tool.created_by': SCHOOL_CONFIG,
  'public.lti_resource_link.created_by': SCHOOL_CONFIG,
  'public.roster_source.created_by': SCHOOL_CONFIG,
  'public.roster_run.created_by': SCHOOL_CONFIG,
  'public.roster_run.applied_by': SCHOOL_CONFIG,
  'public.translation_setting.updated_by': SCHOOL_CONFIG,
  'student.school_join_code.created_by': SCHOOL_CONFIG,

  // Logs whose person column is only the administrator who acted.
  'public.sso_audit_log.actor_id':
    'Sign-in configuration change log: holds the administrator\'s id and the setting changed, nothing else about them. Kept for accountability.',
  'public.integration_audit_log.actor_id':
    'Webhook configuration change log: holds the administrator\'s id and the setting changed, nothing else about them. Kept for accountability.',
  'public.roster_change.target_id':
    'Per-run change sets of a rostering sync, kept with the run for the administrator; the current record from the school\'s information system is exported from roster_link.',

  // This module's own table.
  'compliance.data_export.requested_by':
    'The export requests themselves: ids and status only, listed in the app while they exist and recorded in the audit log.',
  'compliance.data_export.subject_user_id': 'As compliance.data_export.requested_by.',
  'compliance.data_export.student_id': 'As compliance.data_export.requested_by.',
};

/** Columns covered by some collector. */
export function coveredColumns(): Set<string> {
  return new Set(COLLECTORS.flatMap((c) => c.covers));
}

/** The collectors an export of this scope runs. */
export function collectorsFor(scope: ExportScope): Collector[] {
  return COLLECTORS.filter((c) => c.scopes.includes(scope));
}
