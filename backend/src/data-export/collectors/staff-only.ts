import type { Prisma } from '@/generated/prisma/client';
import type { Collector, ExportObject } from '../data-export.types';
import { openText } from '@/account/sensitive-text';
import { courseNames, day, personNames, studentIn } from './helpers';
import { fileObject } from './files';

/**
 * Records staff keep about a student. They go into staff exports only (a
 * school answering a subject access request), never into self or parent
 * exports; see README.md ("Pastoral notes and other staff records").
 */

export const pastoralCollector: Collector = {
  id: 'pastoral-notes',
  title: 'Behaviour and pastoral notes',
  description:
    'Behaviour, wellbeing and pastoral notes staff recorded about the student: category, severity, date, the note, follow-up, status, and attached files (copied into files/pastoral/).',
  covers: ['student.pastoral_note.student_id'],
  scopes: ['staff'],
  async collect(ctx) {
    const { subject } = ctx;
    if (subject.studentIds.length === 0 || !subject.schoolId) return { data: [], count: 0, internal: { withheld: 0, complete: 0 } };
    const view = subject.pastoral ?? { read: false, safeguarding: false, enabled: false };
    // The same rule as the app (pastoral-access.ts visibleNotes): their own
    // notes; with read every non-safeguarding note; with safeguarding too,
    // every note.
    const or: Prisma.pastoral_noteWhereInput[] = [{ author_id: subject.exporterId }];
    if (view.read) or.push(view.safeguarding ? { school_id: subject.schoolId } : { is_safeguarding: false });
    const where: Prisma.pastoral_noteWhereInput = {
      student_id: studentIn(ctx),
      school_id: subject.schoolId,
      OR: or,
    };
    const [notes, withheld] = await Promise.all([
      ctx.prisma.pastoral_note.findMany({
        where: { ...where, sar_withheld: false },
        select: {
          id: true,
          is_safeguarding: true,
          severity: true,
          occurred_on: true,
          body: true,
          follow_up_on: true,
          status: true,
          resolved_at: true,
          created_at: true,
          updated_at: true,
          author_id: true,
          assigned_to: true,
          category: { select: { label: true, kind: true } },
          files: {
            select: {
              file: {
                select: { id: true, name: true, bucket: true, storage_path: true, status: true, size_bytes: true, deleted_at: true },
              },
            },
          },
        },
        orderBy: { occurred_on: 'asc' },
      }),
      ctx.prisma.pastoral_note.count({ where: { ...where, sar_withheld: true } }),
    ]);
    const people = await personNames(ctx, notes.flatMap((n) => [n.author_id, n.assigned_to]));
    const objects: ExportObject[] = [];
    const data = notes.map((n) => ({
      category: n.category.label,
      kind: n.category.kind,
      safeguarding: n.is_safeguarding,
      severity: n.severity,
      occurredOn: day(n.occurred_on),
      note: openText('pastoral_note.body', n.id, n.body),
      followUpOn: day(n.follow_up_on),
      status: n.status,
      resolvedAt: n.resolved_at,
      writtenBy: n.author_id ? (people.get(n.author_id) ?? null) : null,
      assignedTo: n.assigned_to ? (people.get(n.assigned_to) ?? null) : null,
      writtenAt: n.created_at,
      updatedAt: n.updated_at,
      files: n.files
        .filter((f) => !f.file.deleted_at)
        .map((f) => {
          const obj = fileObject('pastoral', f.file);
          if (obj) objects.push(obj);
          return { name: f.file.name, copiedTo: obj?.path ?? null };
        }),
    }));
    return {
      data,
      count: data.length,
      objects,
      internal: { withheld, complete: view.read && view.safeguarding ? 1 : 0 },
    };
  },
};

export const staffRecordsCollector: Collector = {
  id: 'staff-records',
  title: 'Staff records about the student',
  description:
    'Flags the school\'s systems raised about the student and staff comments: at-risk analytics (grade, missing work, attendance rate, reasons), attendance alerts, similarity (possible copying) matches on submitted work, report card comments (including drafts), and parent invitations sent for the student.',
  covers: [
    'public.analytics_at_risk.student_id',
    'student.attendance_alert.student_id',
    'grading.report_comment.student_id',
    'grading.report_head_comment.student_id',
    'student.parent_invite.student_id',
  ],
  scopes: ['staff'],
  async collect(ctx) {
    const { prisma, subject } = ctx;
    if (subject.studentIds.length === 0 || !subject.schoolId) {
      return { data: { atRisk: [], attendanceAlerts: [], similarity: [], reportComments: [], parentInvites: [] }, count: 0 };
    }
    const school = { school_id: subject.schoolId };
    const [atRisk, alerts, comments, headComments, invites, fingerprints] = await Promise.all([
      prisma.analytics_at_risk.findMany({
        where: { student_id: studentIn(ctx), ...school },
        select: { course_id: true, grade: true, missing: true, attendance_rate: true, mastery_score: true, reasons: true, computed_at: true },
      }),
      prisma.attendance_alert.findMany({
        where: { student_id: studentIn(ctx), ...school },
        select: { kind: true, value: true, threshold: true, window_days: true, opened_at: true, resolved_at: true, acknowledged_at: true },
        orderBy: { opened_at: 'asc' },
      }),
      prisma.report_comment.findMany({
        where: { student_id: studentIn(ctx), course: school },
        select: { term_id: true, course_id: true, body: true, status: true, author_id: true, updated_at: true },
      }),
      prisma.report_head_comment.findMany({
        where: { student_id: studentIn(ctx), term: { academic_year: school } },
        select: { term_id: true, body: true, author_id: true, updated_at: true },
      }),
      prisma.parent_invite.findMany({
        where: { student_id: studentIn(ctx), ...school },
        select: { kind: true, email: true, relationship: true, relationship_label: true, created_at: true, expires_at: true, used_at: true, revoked_at: true },
      }),
      prisma.similarity_fingerprint.findMany({
        where: { submission: { student_id: studentIn(ctx) }, ...school },
        select: { id: true, part: true, word_count: true, computed_at: true, activity_id: true, course_id: true },
      }),
    ]);
    const matches = fingerprints.length
      ? await prisma.similarity_match.findMany({
          where: { fingerprint_id: { in: fingerprints.map((f) => f.id) } },
          select: { fingerprint_id: true, score: true, shared: true, created_at: true },
          orderBy: { score: 'desc' },
        })
      : [];
    const activities = fingerprints.length
      ? await prisma.activity.findMany({
          where: { id: { in: fingerprints.map((f) => f.activity_id) } },
          select: { id: true, title: true },
        })
      : [];
    const activityTitle = new Map(activities.map((a) => [a.id, a.title]));
    const fp = new Map(fingerprints.map((f) => [f.id, f]));
    const termIds = [...comments.map((c) => c.term_id), ...headComments.map((c) => c.term_id)];
    const terms = termIds.length
      ? await prisma.term.findMany({ where: { id: { in: termIds } }, select: { id: true, name: true } })
      : [];
    const termName = new Map(terms.map((t) => [t.id, t.name]));
    const courses = await courseNames(ctx, [
      ...atRisk.map((r) => r.course_id),
      ...comments.map((c) => c.course_id),
      ...fingerprints.map((f) => f.course_id),
    ]);
    const authors = await personNames(ctx, [...comments.map((c) => c.author_id), ...headComments.map((c) => c.author_id)]);

    const data = {
      atRisk: atRisk.map((r) => ({
        course: courses.get(r.course_id) ?? null,
        grade: r.grade,
        missingWork: r.missing,
        attendanceRate: r.attendance_rate,
        masteryScore: r.mastery_score,
        reasons: r.reasons,
        computedAt: r.computed_at,
      })),
      attendanceAlerts: alerts.map((a) => ({
        kind: a.kind,
        value: a.value,
        threshold: a.threshold,
        windowDays: a.window_days,
        openedAt: a.opened_at,
        resolvedAt: a.resolved_at,
        acknowledgedAt: a.acknowledged_at,
      })),
      // The other submission's student is left out: it is someone else's data.
      similarity: matches.map((m) => {
        const f = fp.get(m.fingerprint_id);
        return {
          course: f ? (courses.get(f.course_id) ?? null) : null,
          activity: f ? (activityTitle.get(f.activity_id) ?? null) : null,
          part: f?.part || null,
          percentFoundElsewhere: m.score,
          sharedFingerprints: m.shared,
          foundAt: m.created_at,
        };
      }),
      reportComments: [
        ...comments.map((c) => ({
          term: termName.get(c.term_id) ?? null,
          course: courses.get(c.course_id) ?? null,
          comment: c.body,
          status: c.status,
          writtenBy: c.author_id ? (authors.get(c.author_id) ?? null) : null,
          updatedAt: c.updated_at,
        })),
        ...headComments.map((c) => ({
          term: termName.get(c.term_id) ?? null,
          course: null,
          comment: c.body,
          status: 'head',
          writtenBy: c.author_id ? (authors.get(c.author_id) ?? null) : null,
          updatedAt: c.updated_at,
        })),
      ],
      parentInvites: invites.map((i) => ({
        kind: i.kind,
        // Guardian contact details need student:sensitive.
        email: subject.sensitive ? i.email : undefined,
        relationship: i.relationship_label ?? i.relationship,
        sentAt: i.created_at,
        expiresAt: i.expires_at,
        usedAt: i.used_at,
        revokedAt: i.revoked_at,
      })),
    };
    const count =
      data.atRisk.length +
      data.attendanceAlerts.length +
      data.similarity.length +
      data.reportComments.length +
      data.parentInvites.length;
    return { data, count };
  },
};
