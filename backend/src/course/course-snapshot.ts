import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';

/**
 * A course's *design* as plain JSON: what course copy, import and the
 * template library carry from one course to another.
 *
 * `readSnapshot` reads it from a course, `selectSnapshot` narrows it to chosen
 * modules, quizzes, rubrics and pages (with whatever they depend on), and
 * `writeSnapshot` re-creates it inside another course with new ids. Copy and
 * import go straight from read to write; the library stores the snapshot as
 * an immutable version (`course.library_item_version.content`) and writes it
 * when someone imports.
 *
 * What is in it, and only this: assignment groups, rubrics (criteria and
 * ratings), question banks, activities with their quiz questions, options and
 * bank draws, pages, modules, module items, staff-written discussion prompts,
 * the discussion setting, and the files module items link (metadata and where
 * the bytes are, never the file row itself). Never students, enrolments,
 * submissions, marks, rubric assessments, peer reviews, attendance,
 * extensions, accommodations, announcements, replies, student-started topics
 * or LTI deployments (an external tool item keeps only its tool id and custom
 * parameters; the importing school's own deployment is used, or the item is
 * skipped).
 */

type Db = Prisma.TransactionClient;

export const SNAPSHOT_VERSION = 1;

export interface SnapshotQuestion {
  /** The source question's id (maps outcome alignments onto the copy). */
  id?: string;
  prompt: string;
  kind: string;
  points: string;
  sortOrder: number;
  numericAnswer: string | null;
  numericTolerance: string;
  partialCredit: boolean;
  rubricId: string | null;
  fileTypes: string[];
  fileMaxMb: number | null;
  options: {
    label: string;
    isCorrect: boolean;
    sortOrder: number;
    matchLabel: string | null;
  }[];
}

export interface SnapshotFile {
  /** The source file's id (relinked inside page and activity text). */
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** Where the bytes are: the live file (copy) or the library's copy. */
  bucket: string;
  path: string;
}

export interface CourseSnapshot {
  v: typeof SNAPSHOT_VERSION;
  /** The course id the snapshot was read from (relinked to the target). */
  sourceCourseId: string;
  description: string | null;
  bannerColor: string | null;
  discussion: { studentsCanCreateTopics: boolean } | null;
  groups: {
    id: string;
    name: string;
    weight: string | null;
    position: number;
    dropLowest: number;
    dropHighest: number;
  }[];
  rubrics: {
    id: string;
    title: string;
    criteria: {
      id?: string;
      title: string;
      description: string | null;
      points: string;
      position: number;
      ratings: {
        label: string;
        description: string | null;
        points: string;
        position: number;
      }[];
    }[];
  }[];
  banks: { id: string; title: string; questions: SnapshotQuestion[] }[];
  activities: {
    id: string;
    kind: string;
    title: string;
    instructions: string | null;
    points: string;
    dueAt: string | null;
    lateUntil: string | null;
    latePenaltyMode: string;
    latePenaltyValue: string | null;
    latePenaltyCap: string | null;
    allowFile: boolean;
    allowMultipleFiles: boolean;
    allowText: boolean;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    lockdownBrowser: boolean;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    groupId: string | null;
    omitFromFinalGrade: boolean;
    rubricId: string | null;
    questions: SnapshotQuestion[];
    draws: { bankId: string; drawCount: number; sortOrder: number }[];
  }[];
  pages: { id: string; title: string; body: string; isPublished: boolean }[];
  modules: { id: string; title: string; position: number; isPublished: boolean }[];
  items: {
    moduleId: string;
    position: number;
    itemType: string;
    title: string | null;
    pageId: string | null;
    activityId: string | null;
    fileId: string | null;
    topicId: string | null;
    url: string | null;
    indent: number;
    isPublished: boolean;
    externalTool: { toolId: string; customParams: unknown } | null;
  }[];
  topics: {
    id: string;
    title: string;
    body: string;
    isPinned: boolean;
    isLocked: boolean;
    requireInitialPost: boolean;
  }[];
  files: SnapshotFile[];
}

/** What one write created, so the caller can show it. */
export interface CopyCounts {
  assignmentGroups: number;
  rubrics: number;
  activities: number;
  quizQuestions: number;
  pages: number;
  modules: number;
  moduleItems: number;
  discussionTopics: number;
  questionBanks: number;
  files: number;
}

/** Chosen parts of a course; empty or absent means the whole course. */
export interface SnapshotSelection {
  moduleIds?: string[];
  activityIds?: string[];
  pageIds?: string[];
  rubricIds?: string[];
}

/** Decimal columns (Prisma.Decimal, number or string) as exact strings. */
type Numeric = { toString(): string } | number | string | null | undefined;
const num = (v: Numeric): string => (v === null || v === undefined ? '0' : v.toString());
const numOrNull = (v: Numeric): string | null =>
  v === null || v === undefined ? null : v.toString();
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

type QuestionRow = {
  id: string;
  prompt: string;
  kind: string;
  points: Numeric;
  sort_order: number;
  numeric_answer?: Numeric;
  numeric_tolerance?: Numeric;
  partial_credit?: boolean | null;
  rubric_id?: string | null;
  file_types?: string[] | null;
  file_max_mb?: number | null;
  quiz_option?: {
    label: string;
    is_correct: boolean;
    sort_order: number;
    match_label?: string | null;
  }[];
};

function question(q: QuestionRow): SnapshotQuestion {
  return {
    id: q.id,
    prompt: q.prompt,
    kind: q.kind,
    points: num(q.points),
    sortOrder: q.sort_order,
    numericAnswer: numOrNull(q.numeric_answer),
    numericTolerance: num(q.numeric_tolerance ?? 0),
    partialCredit: !!q.partial_credit,
    rubricId: q.rubric_id ?? null,
    fileTypes: q.file_types ?? [],
    fileMaxMb: q.file_max_mb ?? null,
    options: (q.quiz_option ?? []).map((o) => ({
      label: o.label,
      isCorrect: o.is_correct,
      sortOrder: o.sort_order,
      matchLabel: o.match_label ?? null,
    })),
  };
}

/**
 * Read a course's design. Only design tables are read (see the file
 * comment); file items are kept while their file is live, ready and in the
 * course's own school, recorded with where the bytes are.
 */
export async function readSnapshot(
  db: Db,
  course: { id: string; school_id: string; description: string | null; banner_color: string | null },
): Promise<CourseSnapshot> {
  const courseId = course.id;
  const [groups, rubrics, banks, activities, pages, modules, items, topics, setting] =
    await Promise.all([
      db.assignment_group.findMany({
        where: { course_id: courseId },
        orderBy: { position: 'asc' },
      }),
      db.rubric.findMany({
        where: { course_id: courseId },
        include: { rubric_criterion: { include: { rubric_rating: true } } },
      }),
      db.question_bank.findMany({
        where: { course_id: courseId },
        include: { quiz_question: { include: { quiz_option: true } } },
        orderBy: { created_at: 'asc' },
      }),
      db.activity.findMany({
        where: { course_id: courseId },
        include: {
          quiz_question: { include: { quiz_option: true } },
          quiz_bank_draw: true,
        },
        orderBy: { created_at: 'asc' },
      }),
      db.page.findMany({
        where: { course_id: courseId },
        orderBy: { created_at: 'asc' },
      }),
      db.module.findMany({
        where: { course_id: courseId },
        orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
      }),
      db.module_item.findMany({
        where: { course_id: courseId },
        include: {
          lti_resource_link: { select: { tool_id: true, custom_params: true } },
        },
        orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
      }),
      db.discussion_topic.findMany({
        where: { course_id: courseId },
        include: { user_profile: { select: { account_type: true } } },
        orderBy: { created_at: 'asc' },
      }),
      db.discussion_setting.findUnique({
        where: { course_id: courseId },
        select: { students_can_create_topics: true },
      }),
    ]);

  const fileIds = [
    ...new Set(
      (items ?? []).map((i) => i.file_id).filter((id): id is string => !!id),
    ),
  ];
  const files =
    fileIds.length === 0
      ? []
      : await db.file.findMany({
          where: {
            id: { in: fileIds },
            school_id: course.school_id,
            deleted_at: null,
            status: 'ready',
          },
          select: {
            id: true,
            name: true,
            content_type: true,
            size_bytes: true,
            bucket: true,
            storage_path: true,
          },
        });

  // Topics students started belong to the old class, not the design.
  const staffTopics = (topics ?? []).filter(
    (t) => t.user_profile?.account_type !== 'student',
  );

  return {
    v: SNAPSHOT_VERSION,
    sourceCourseId: courseId,
    description: course.description,
    bannerColor: course.banner_color,
    discussion: setting
      ? { studentsCanCreateTopics: setting.students_can_create_topics }
      : null,
    groups: (groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      weight: numOrNull(g.weight),
      position: g.position,
      dropLowest: g.drop_lowest,
      dropHighest: g.drop_highest,
    })),
    rubrics: (rubrics ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      criteria: (r.rubric_criterion ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        points: num(c.points),
        position: c.position,
        ratings: (c.rubric_rating ?? []).map((x) => ({
          label: x.label,
          description: x.description,
          points: num(x.points),
          position: x.position,
        })),
      })),
    })),
    banks: (banks ?? []).map((b) => ({
      id: b.id,
      title: b.title,
      questions: (b.quiz_question ?? []).map((q) => question(q as QuestionRow)),
    })),
    activities: (activities ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      instructions: a.instructions,
      points: num(a.points),
      dueAt: iso(a.due_at),
      lateUntil: iso(a.late_until),
      latePenaltyMode: a.late_penalty_mode ?? 'none',
      latePenaltyValue: numOrNull(a.late_penalty_value),
      latePenaltyCap: numOrNull(a.late_penalty_cap),
      allowFile: !!a.allow_file,
      allowMultipleFiles: !!a.allow_multiple_files,
      allowText: !!a.allow_text,
      maxAttempts: a.max_attempts ?? null,
      timeLimitMinutes: a.time_limit_minutes ?? null,
      lockdownBrowser: !!a.lockdown_browser,
      shuffleQuestions: !!a.shuffle_questions,
      shuffleOptions: !!a.shuffle_options,
      groupId: a.assignment_group_id,
      omitFromFinalGrade: !!a.omit_from_final_grade,
      rubricId: a.rubric_id,
      questions: (a.quiz_question ?? []).map((q) => question(q as QuestionRow)),
      draws: (a.quiz_bank_draw ?? []).map((d) => ({
        bankId: d.bank_id,
        drawCount: d.draw_count,
        sortOrder: d.sort_order,
      })),
    })),
    pages: (pages ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      isPublished: p.is_published,
    })),
    modules: (modules ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      position: m.position,
      isPublished: m.is_published,
    })),
    items: (items ?? []).map((i) => ({
      moduleId: i.module_id,
      position: i.position,
      itemType: i.item_type,
      title: i.title,
      pageId: i.page_id,
      activityId: i.activity_id,
      fileId: i.file_id,
      topicId: i.discussion_topic_id ?? null,
      url: i.url,
      indent: i.indent,
      isPublished: i.is_published,
      externalTool: i.lti_resource_link
        ? {
            toolId: i.lti_resource_link.tool_id,
            customParams: i.lti_resource_link.custom_params ?? {},
          }
        : null,
    })),
    topics: staffTopics.map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      isPinned: t.is_pinned,
      isLocked: t.is_locked,
      requireInitialPost: t.require_initial_post,
    })),
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      contentType: f.content_type,
      sizeBytes: Number(f.size_bytes),
      bucket: f.bucket,
      path: f.storage_path,
    })),
  };
}

/** True when the selection names nothing (the whole course). */
export function isWholeCourse(sel?: SnapshotSelection | null): boolean {
  return (
    !sel ||
    [sel.moduleIds, sel.activityIds, sel.pageIds, sel.rubricIds].every(
      (l) => !l || l.length === 0,
    )
  );
}

/**
 * Narrow a snapshot to chosen modules, activities, pages and rubrics, plus
 * everything they need: a module's items and the pages, activities and
 * prompts those point at; an activity's rubric, assignment group and the
 * banks it draws from; a question's rubric; an item's file. Ids that are not
 * in the course are ignored. The whole course when nothing is chosen.
 */
export function selectSnapshot(
  snap: CourseSnapshot,
  sel?: SnapshotSelection | null,
): CourseSnapshot {
  if (isWholeCourse(sel)) return snap;
  const moduleIds = new Set(sel!.moduleIds ?? []);
  const activityIds = new Set(sel!.activityIds ?? []);
  const pageIds = new Set(sel!.pageIds ?? []);
  const rubricIds = new Set(sel!.rubricIds ?? []);
  const topicIds = new Set<string>();
  const fileIds = new Set<string>();

  const modules = snap.modules.filter((m) => moduleIds.has(m.id));
  const items = snap.items.filter((i) => moduleIds.has(i.moduleId));
  for (const i of items) {
    if (i.activityId) activityIds.add(i.activityId);
    if (i.pageId) pageIds.add(i.pageId);
    if (i.topicId) topicIds.add(i.topicId);
    if (i.fileId) fileIds.add(i.fileId);
  }

  const activities = snap.activities.filter((a) => activityIds.has(a.id));
  const bankIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const a of activities) {
    if (a.rubricId) rubricIds.add(a.rubricId);
    if (a.groupId) groupIds.add(a.groupId);
    for (const q of a.questions) if (q.rubricId) rubricIds.add(q.rubricId);
    for (const d of a.draws) bankIds.add(d.bankId);
  }
  const banks = snap.banks.filter((b) => bankIds.has(b.id));
  for (const b of banks) {
    for (const q of b.questions) if (q.rubricId) rubricIds.add(q.rubricId);
  }

  return {
    ...snap,
    // Course-wide settings belong to the whole course only.
    discussion: null,
    groups: snap.groups.filter((g) => groupIds.has(g.id)),
    rubrics: snap.rubrics.filter((r) => rubricIds.has(r.id)),
    banks,
    activities,
    pages: snap.pages.filter((p) => pageIds.has(p.id)),
    modules,
    items,
    topics: snap.topics.filter((t) => topicIds.has(t.id)),
    files: snap.files.filter((f) => fileIds.has(f.id)),
  };
}

/** Counts shown when browsing the library and previewing an import. */
export function snapshotCounts(snap: CourseSnapshot) {
  return {
    modules: snap.modules.length,
    moduleItems: snap.items.length,
    pages: snap.pages.length,
    activities: snap.activities.length,
    quizzes: snap.activities.filter((a) => a.kind === 'quiz').length,
    rubrics: snap.rubrics.length,
    questionBanks: snap.banks.length,
    discussionTopics: snap.topics.length,
    files: snap.files.length,
    externalTools: snap.items.filter((i) => i.itemType === 'external_tool').length,
  };
}

/** A date moved by `shift` ms; null `shift` clears it. */
export function shiftDate(date: Date | null, shift: number | null) {
  if (!date || shift === null) return null;
  return shift === 0 ? date : new Date(date.getTime() + shift);
}

const shiftIso = (value: string | null, shift: number | null) =>
  shiftDate(value ? new Date(value) : null, shift);

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Rewrite ids of copied rows inside text (a link from one page to another
 * page or activity of the same course, or to the course itself), so links in
 * the copy stay inside the copy. Ids that were not copied are left alone.
 */
export function relinkIds(text: string, ids: Map<string, string>) {
  if (!text) return text;
  return text.replace(UUID_RE, (id) => ids.get(id.toLowerCase()) ?? id);
}

export interface WriteContext {
  targetId: string;
  userId: string;
  /** Milliseconds to move dates by; null clears due dates. */
  shift: number | null;
  /** Snapshot file id -> the importer's own copy (already reserved). */
  fileIds: Map<string, string>;
  /** Tool id -> a deployment of it that reaches the target's school. */
  ltiDeployments: Map<string, string>;
  /** Tool names, for the note when one is skipped. */
  toolNames?: Map<string, string>;
}

export interface WriteResult {
  counts: CopyCounts;
  /** Things left behind and why, for the person importing. */
  notes: string[];
  /** Source id -> new id for every copied row (for follow-up copies). */
  ids: Map<string, string>;
}

/**
 * Re-create a snapshot inside `ctx.targetId`. Ids are minted here so every
 * pointer can be repointed before anything is written, and each table goes
 * in with one `createMany`, parents first. On an import, assignment groups
 * with the same name (case-insensitive) are merged and modules and groups
 * land after the target's own. Activities arrive as drafts; discussion
 * prompts unpublished and empty.
 */
export async function writeSnapshot(
  tx: Db,
  snap: CourseSnapshot,
  ctx: WriteContext,
): Promise<WriteResult> {
  const { targetId, userId, shift } = ctx;
  const notes: string[] = [];

  const [targetGroups, lastModule, lastGroup] = await Promise.all([
    tx.assignment_group.findMany({
      where: { course_id: targetId },
      select: { id: true, name: true },
    }),
    tx.module.aggregate({
      where: { course_id: targetId },
      _max: { position: true },
    }),
    tx.assignment_group.aggregate({
      where: { course_id: targetId },
      _max: { position: true },
    }),
  ]);
  const moduleMax = lastModule?._max?.position;
  const groupMax = lastGroup?._max?.position;
  const moduleOffset = moduleMax === null || moduleMax === undefined ? 0 : moduleMax + 1;
  const groupOffset = groupMax === null || groupMax === undefined ? 0 : groupMax + 1;

  // source id -> copy id, for every row anything points at; also used to
  // rewrite links inside page, activity and topic text.
  const ids = new Map<string, string>([[snap.sourceCourseId, targetId]]);
  for (const [from, to] of ctx.fileIds) ids.set(from, to);
  const mint = (oldId: string) => {
    const id = randomUUID();
    ids.set(oldId, id);
    return id;
  };

  const byName = new Map(
    (targetGroups ?? []).map((g) => [g.name.trim().toLowerCase(), g.id]),
  );
  const newGroups: Prisma.assignment_groupCreateManyInput[] = [];
  for (const g of snap.groups) {
    const existing = byName.get(g.name.trim().toLowerCase());
    if (existing) {
      ids.set(g.id, existing);
      continue;
    }
    newGroups.push({
      id: mint(g.id),
      course_id: targetId,
      name: g.name,
      weight: g.weight,
      position: g.position + groupOffset,
      drop_lowest: g.dropLowest,
      drop_highest: g.dropHighest,
    });
  }

  const newRubrics: Prisma.rubricCreateManyInput[] = [];
  const newCriteria: Prisma.rubric_criterionCreateManyInput[] = [];
  const newRatings: Prisma.rubric_ratingCreateManyInput[] = [];
  for (const r of snap.rubrics) {
    const rubricId = mint(r.id);
    newRubrics.push({ id: rubricId, course_id: targetId, title: r.title, created_by: userId });
    for (const c of r.criteria) {
      const criterionId = c.id ? mint(c.id) : randomUUID();
      newCriteria.push({
        id: criterionId,
        rubric_id: rubricId,
        title: c.title,
        description: c.description,
        points: c.points,
        position: c.position,
      });
      for (const x of c.ratings) {
        newRatings.push({
          criterion_id: criterionId,
          label: x.label,
          description: x.description,
          points: x.points,
          position: x.position,
        });
      }
    }
  }

  // Mint page, activity and topic ids before writing any text, so links can
  // be rewritten whichever way round they point.
  for (const a of snap.activities) mint(a.id);
  for (const p of snap.pages) mint(p.id);
  for (const t of snap.topics) mint(t.id);
  const relink = (text: string) => relinkIds(text, ids);

  const newBanks: Prisma.question_bankCreateManyInput[] = snap.banks.map((b) => ({
    id: mint(b.id),
    course_id: targetId,
    title: b.title,
    created_by: userId,
  }));

  const newQuestions: Prisma.quiz_questionCreateManyInput[] = [];
  const newOptions: Prisma.quiz_optionCreateManyInput[] = [];
  const addQuestion = (
    q: SnapshotQuestion,
    owner: { activity_id: string } | { bank_id: string },
  ) => {
    const questionId = q.id ? mint(q.id) : randomUUID();
    newQuestions.push({
      id: questionId,
      ...owner,
      prompt: q.prompt,
      kind: q.kind as Prisma.quiz_questionCreateManyInput['kind'],
      points: q.points,
      sort_order: q.sortOrder,
      numeric_answer: q.numericAnswer,
      numeric_tolerance: q.numericTolerance,
      partial_credit: q.partialCredit,
      rubric_id: q.rubricId ? (ids.get(q.rubricId) ?? null) : null,
      file_types: q.fileTypes,
      file_max_mb: q.fileMaxMb,
    });
    for (const o of q.options) {
      newOptions.push({
        question_id: questionId,
        label: o.label,
        is_correct: o.isCorrect,
        sort_order: o.sortOrder,
        match_label: o.matchLabel,
      });
    }
  };
  for (const b of snap.banks) {
    for (const q of b.questions) addQuestion(q, { bank_id: ids.get(b.id)! });
  }

  // Activities arrive as drafts: dates moved and everything reviewed before
  // students see it; publishing then notifies them as usual.
  const newActivities: Prisma.activityCreateManyInput[] = [];
  const newDraws: Prisma.quiz_bank_drawCreateManyInput[] = [];
  for (const a of snap.activities) {
    const activityId = ids.get(a.id)!;
    const dueAt = shiftIso(a.dueAt, shift);
    newActivities.push({
      id: activityId,
      course_id: targetId,
      kind: a.kind as Prisma.activityCreateManyInput['kind'],
      title: a.title,
      instructions: a.instructions === null ? null : relink(a.instructions),
      points: a.points,
      due_at: dueAt,
      // Late work runs on from the due date; without one there is nothing to be late for.
      late_until: dueAt ? shiftIso(a.lateUntil, shift) : null,
      late_penalty_mode: a.latePenaltyMode as Prisma.activityCreateManyInput['late_penalty_mode'],
      late_penalty_value: a.latePenaltyValue,
      late_penalty_cap: a.latePenaltyCap,
      status: 'draft',
      published_at: null,
      allow_file: a.allowFile,
      allow_multiple_files: a.allowMultipleFiles,
      allow_text: a.allowText,
      max_attempts: a.maxAttempts,
      time_limit_minutes: a.timeLimitMinutes,
      lockdown_browser: a.lockdownBrowser,
      shuffle_questions: a.shuffleQuestions,
      shuffle_options: a.shuffleOptions,
      assignment_group_id: a.groupId ? (ids.get(a.groupId) ?? null) : null,
      omit_from_final_grade: a.omitFromFinalGrade,
      rubric_id: a.rubricId ? (ids.get(a.rubricId) ?? null) : null,
      created_by: userId,
    });
    for (const q of a.questions) addQuestion(q, { activity_id: activityId });
    for (const d of a.draws) {
      const bankId = ids.get(d.bankId);
      if (!bankId) continue;
      newDraws.push({
        activity_id: activityId,
        bank_id: bankId,
        draw_count: d.drawCount,
        sort_order: d.sortOrder,
      });
    }
  }

  // Pages, modules and items keep their published flags: a new course is a
  // draft, and on an import activities are drafts, so nothing graded goes
  // out until the teacher publishes it.
  const newPages: Prisma.pageCreateManyInput[] = snap.pages.map((p) => ({
    id: ids.get(p.id)!,
    course_id: targetId,
    title: p.title,
    body: relink(p.body),
    is_published: p.isPublished,
    created_by: userId,
  }));

  const newModules: Prisma.moduleCreateManyInput[] = snap.modules.map((m) => ({
    id: mint(m.id),
    course_id: targetId,
    title: m.title,
    position: m.position + moduleOffset,
    is_published: m.isPublished,
  }));

  const newTopics: Prisma.discussion_topicCreateManyInput[] = snap.topics.map((t) => ({
    id: ids.get(t.id)!,
    course_id: targetId,
    author_user_profile_id: userId,
    title: t.title,
    body: relink(t.body),
    is_pinned: t.isPinned,
    is_locked: t.isLocked,
    is_published: false,
    require_initial_post: t.requireInitialPost,
  }));

  const newItems: Prisma.module_itemCreateManyInput[] = [];
  const newLinks: Prisma.lti_resource_linkCreateManyInput[] = [];
  let skippedFiles = 0;
  for (const i of snap.items) {
    const moduleId = ids.get(i.moduleId);
    if (!moduleId) continue;
    let fileId: string | null = null;
    if (i.fileId) {
      const copy = ctx.fileIds.get(i.fileId);
      // A file that was not copied (deleted, never ready) is left behind.
      if (!copy) {
        skippedFiles++;
        continue;
      }
      fileId = copy;
    }
    const pageId = i.pageId ? ids.get(i.pageId) : null;
    const activityId = i.activityId ? ids.get(i.activityId) : null;
    const topicId = i.topicId ? ids.get(i.topicId) : null;
    // An item whose target was not copied (a topic a student started) would
    // break the item-type check; leave it behind.
    if (pageId === undefined || activityId === undefined || topicId === undefined) {
      continue;
    }
    const itemId = randomUUID();
    if (i.itemType === 'external_tool') {
      const tool = i.externalTool;
      const deploymentId = tool ? ctx.ltiDeployments.get(tool.toolId) : undefined;
      if (!tool || !deploymentId) {
        const toolName = tool ? ctx.toolNames?.get(tool.toolId) : undefined;
        notes.push(
          `"${i.title ?? toolName ?? 'External tool'}" was skipped: ${toolName ? `the tool ${toolName}` : 'its external tool'} is not available to this school.`,
        );
        continue;
      }
      newLinks.push({
        tool_id: tool.toolId,
        deployment_id: deploymentId,
        course_id: targetId,
        module_item_id: itemId,
        custom_params: (tool.customParams ?? {}),
        created_by: userId,
      });
    }
    newItems.push({
      id: itemId,
      module_id: moduleId,
      course_id: targetId,
      position: i.position,
      item_type: i.itemType as Prisma.module_itemCreateManyInput['item_type'],
      title: i.title,
      page_id: pageId,
      activity_id: activityId,
      file_id: fileId,
      discussion_topic_id: topicId,
      url: i.url,
      indent: i.indent,
      is_published: i.isPublished,
    });
  }
  if (skippedFiles > 0) {
    notes.push(
      `${skippedFiles} file item${skippedFiles === 1 ? ' was' : 's were'} skipped: the file is no longer available.`,
    );
  }

  const writes: [unknown[], (rows: any[]) => Promise<unknown>][] = [
    [newGroups, (data) => tx.assignment_group.createMany({ data })],
    [newRubrics, (data) => tx.rubric.createMany({ data })],
    [newCriteria, (data) => tx.rubric_criterion.createMany({ data })],
    [newRatings, (data) => tx.rubric_rating.createMany({ data })],
    [newBanks, (data) => tx.question_bank.createMany({ data })],
    [newActivities, (data) => tx.activity.createMany({ data })],
    [newQuestions, (data) => tx.quiz_question.createMany({ data })],
    [newOptions, (data) => tx.quiz_option.createMany({ data })],
    [newDraws, (data) => tx.quiz_bank_draw.createMany({ data })],
    [newPages, (data) => tx.page.createMany({ data })],
    [newModules, (data) => tx.module.createMany({ data })],
    [newTopics, (data) => tx.discussion_topic.createMany({ data })],
    [newItems, (data) => tx.module_item.createMany({ data })],
    [newLinks, (data) => tx.lti_resource_link.createMany({ data })],
  ];
  for (const [rows, write] of writes) {
    if (rows.length > 0) await write(rows);
  }

  return {
    counts: {
      assignmentGroups: newGroups.length,
      rubrics: newRubrics.length,
      activities: newActivities.length,
      quizQuestions: newQuestions.filter((q) => q.activity_id).length,
      pages: newPages.length,
      modules: newModules.length,
      moduleItems: newItems.length,
      discussionTopics: newTopics.length,
      questionBanks: newBanks.length,
      files: new Set(newItems.map((i) => i.file_id).filter(Boolean)).size,
    },
    notes,
    ids,
  };
}
