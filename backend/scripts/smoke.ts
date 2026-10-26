/**
 * End-to-end smoke test against a running API and the demo school.
 *
 *   bun run seed:demo --fresh   # once, with the API running
 *   bun run smoke
 *
 * Walks the main flows as real users - courses, gradebook, the student
 * portal, attendance (code and QR), email domains and sign-in discovery - and
 * prints PASS/FAIL per check. Exits non-zero on any failure. Cleans up what
 * it creates. Run it after each step of the platform migration.
 *
 * Signs in through the API's dev-only code endpoint, so the API must run with
 * ALLOW_DEV_LOGIN=true. Work that gets marked cannot be deleted through the
 * API (by design), so that cleanup goes straight to DATABASE_URL.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { StorageService } from '../src/storage/storage.service';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const API = `${(process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '')}/api`;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) {
    failures++;
    console.log(`      ${JSON.stringify(detail)?.slice(0, 400)}`);
  }
}

type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; data: any; headers: Headers }>;

async function login(email: string): Promise<Call> {
  const headers = { 'content-type': 'application/json', 'X-API-Version': '1' };
  const issued = await fetch(`${API}/auth/dev/code`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email }),
  });
  if (!issued.ok) throw new Error(`dev code for ${email} -> ${issued.status} (is ALLOW_DEV_LOGIN=true?)`);
  const { code } = (await issued.json()) as { code: string };
  const res = await fetch(`${API}/auth/otp/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, token: code }),
  });
  if (!res.ok) throw new Error(`sign-in for ${email} -> ${res.status}: ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        cookie,
        'X-API-Version': '1',
        ...(body !== undefined && !(body instanceof FormData)
          ? { 'content-type': 'application/json' }
          : {}),
      },
      body:
        body instanceof FormData
          ? body
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
    });
    const text = await r.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: r.status, data: parsed, headers: r.headers };
  };
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isDateOnly = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function main() {
  const teacher = await login('teacher@demo.test');
  const ta = await login('ta@demo.test');
  const admin = await login('admin@demo.test');
  const student = await login('student@demo.test');
  const student2 = await login('student2@demo.test');

  // ── profile and school structure ──────────────────────────────────────────
  const me = await teacher('GET', '/auth/me');
  check('auth/me has nested school', me.status === 200 && !!me.data.school?.id, me.data);
  const years = await admin('GET', '/academic-years');
  check('academic years: dates stay YYYY-MM-DD', years.status === 200 && isDateOnly(years.data[0]?.start_date), years.data[0]);
  const yearId = years.data[0]?.id;
  const terms = await admin('GET', `/terms?yearId=${yearId}`);
  check('terms: dates stay YYYY-MM-DD', terms.status === 200 && isDateOnly(terms.data[0]?.start_date), terms.data[0]);
  const perms = await teacher('GET', '/permissions/me');
  check('teacher can create courses', perms.status === 200 && perms.data.permissions.includes('course:create'), perms.data);

  // ── courses ───────────────────────────────────────────────────────────────
  const courses = await teacher('GET', '/courses');
  const bio = courses.data.find?.((c: any) => c.name === 'Biology 101');
  check('teacher lists Biology 101', courses.status === 200 && !!bio, courses.data);
  check('admin sees every course', (await admin('GET', '/courses')).data.every?.((c: any) => c.role === 'admin'));
  check('TA cannot change settings (403)', (await ta('PATCH', `/courses/${bio.id}`, { name: 'x' })).status === 403);
  const modules = await teacher('GET', `/courses/${bio.id}/modules`);
  check('modules with items', modules.status === 200 && modules.data[0]?.items?.length > 0, modules.data);
  // A file linked from a published module opens for an enrolled student
  // (students hold no file-manager permission, so this goes through the portal).
  const form = new FormData();
  form.append('file', new Blob(['smoke'], { type: 'text/plain' }), 'smoke.txt');
  const uploaded = await teacher('POST', '/files?name=smoke.txt', form);
  check('teacher uploads a file', uploaded.status === 201 && !!uploaded.data.id, uploaded.data);
  const publishedModule = modules.data.find((m: any) => m.isPublished ?? m.is_published);
  if (uploaded.data?.id && publishedModule) {
    const fileId = uploaded.data.id;
    const portalFile = `/portal/me/courses/${bio.id}/files/${fileId}`;
    check('unlinked file is 404 to a student', (await student('GET', portalFile)).status === 404);
    // Course staff open files the course offers through the course route, even
    // a colleague's: the TA did not upload this one.
    const staffFile = `/courses/${bio.id}/files/${fileId}`;
    check("unlinked colleague's file is 404 on the staff route", (await ta('GET', staffFile)).status === 404);
    const item = await teacher('POST', `/courses/${bio.id}/modules/${publishedModule.id}/items`, { itemType: 'file', fileId });
    check('link the file in a module', item.status === 201, item.data);
    const opened = await student('GET', portalFile);
    check('student opens the module file', opened.status === 200 && opened.data === 'smoke', opened.status);
    const staffOpened = await ta('GET', staffFile);
    check("TA opens a colleague's module-linked file (sandboxed)", staffOpened.status === 200 && staffOpened.data === 'smoke' && staffOpened.headers.get('content-security-policy') === 'sandbox' && staffOpened.headers.get('x-content-type-options') === 'nosniff', staffOpened.status);
    const handout = (await db.module_item.findFirst({ where: { course_id: bio.id, item_type: 'file', NOT: { file_id: fileId } }, select: { file_id: true } }))?.file_id;
    check('TA opens the seeded module handout', !!handout && (await ta('GET', `/courses/${bio.id}/files/${handout}`)).status === 200, handout);
    if (item.data?.id) await teacher('DELETE', `/courses/${bio.id}/modules/${publishedModule.id}/items/${item.data.id}`);
    await teacher('DELETE', `/files/${fileId}`);
  } else {
    check('a published module to link into', !!publishedModule, modules.data);
  }
  const search = await teacher('GET', '/students?search=Jor');
  check('student search (no 400)', search.status === 200, search.data);
  const people = await teacher('GET', `/courses/${bio.id}/people`);
  check('people: 12 students', people.status === 200 && people.data.students.length === 12, people.data.students?.length);

  // ── gradebook ─────────────────────────────────────────────────────────────
  const gb = await teacher('GET', `/courses/${bio.id}/gradebook`);
  const jordan = gb.data.students?.find((s: any) => s.firstName === 'Jordan');
  check('gradebook: Jordan 73.03% C', jordan?.grade?.percent === 73.03 && jordan?.grade?.letter === 'C', jordan?.grade);
  const quiz = gb.data.activities?.find((a: any) => a.kind === 'quiz');
  check('quiz score rounded to 6.67', jordan?.cells?.[quiz?.id]?.score === 6.67, jordan?.cells?.[quiz?.id]);
  const csv = await teacher('GET', `/courses/${bio.id}/gradebook/export`);
  check('gradebook CSV', csv.status === 200 && String(csv.data).includes('Jordan'));

  // ── grading extras: CSV import, drop lowest, rubrics ──────────────────────
  const importCsv = (path: string, text: string) => teacher('POST', `/courses/${bio.id}/gradebook/${path}`, { csv: text });
  const roundTrip = await importCsv('import/preview', String(csv.data));
  check('CSV import: the export previews with no changes', roundTrip.status === 200 && roundTrip.data.errors?.length === 0 && roundTrip.data.changes?.length === 0 && roundTrip.data.matchedRows === gb.data.students.length, roundTrip.data);
  check('CSV import: applying the export changes nothing', (await importCsv('import', String(csv.data))).data?.applied === 0);
  const marked = gb.data.activities.find((a: any) => a.kind !== 'quiz' && typeof jordan?.cells?.[a.id]?.score === 'number' && !jordan.cells[a.id].excused);
  if (marked) {
    const was = jordan.cells[marked.id].score;
    const next = was >= 1 ? was - 1 : was + 1;
    const sheet = (v: string) => `Student ID,"${marked.title.replace(/"/g, '""')} (${marked.points})"\r\n${jordan.studentId},${v}\r\n`;
    const bad = await importCsv('import/preview', sheet('abc'));
    check('CSV import: a bad cell is a row error', bad.data?.errors?.length === 1 && bad.data.errors[0].line === 2, bad.data);
    check('CSV import: apply refuses a file with errors (400)', (await importCsv('import', sheet(String(marked.points + 1)))).status === 400);
    const one = await importCsv('import/preview', sheet(String(next)));
    check('CSV import: preview shows the one change', one.data?.changes?.length === 1 && one.data.changes[0].from?.score === was, one.data);
    try {
      const applied = await importCsv('import', sheet(String(next)));
      const after = await teacher('GET', `/courses/${bio.id}/gradebook`);
      const cell = after.data.students.find((s: any) => s.studentId === jordan.studentId)?.cells?.[marked.id];
      check('CSV import: apply writes the mark', applied.data?.applied === 1 && cell?.score === next, { applied: applied.data, cell });
    } finally {
      await importCsv('import', sheet(String(was)));
    }
  }
  const dropGroup = gb.data.groups?.find((g: any) => gb.data.activities.filter((a: any) => a.assignmentGroupId === g.id && jordan?.cells?.[a.id]?.status === 'graded' && !jordan.cells[a.id].excused).length >= 2);
  if (dropGroup) {
    try {
      const set = await teacher('PATCH', `/courses/${bio.id}/assignment-groups/${dropGroup.id}`, { dropLowest: 1 });
      const dropped = (await teacher('GET', `/courses/${bio.id}/gradebook`)).data.students.find((s: any) => s.studentId === jordan.studentId);
      check('drop lowest: one mark dropped, total not lower', set.data?.dropLowest === 1 && dropped?.grade?.dropped?.length === 1 && dropped.cells[dropped.grade.dropped[0]]?.dropped === true && dropped.grade.percent >= 73.03, dropped?.grade);
    } finally {
      await teacher('PATCH', `/courses/${bio.id}/assignment-groups/${dropGroup.id}`, { dropLowest: 0 });
    }
    const restored = (await teacher('GET', `/courses/${bio.id}/gradebook`)).data.students.find((s: any) => s.studentId === jordan.studentId);
    check('drop lowest: restored to 73.03%', restored?.grade?.percent === 73.03, restored?.grade);
  } else {
    check('a group with two of Jordan\'s marks', false, gb.data.groups);
  }
  check('TA cannot build rubrics (403)', (await ta('POST', `/courses/${bio.id}/rubrics`, { title: 'x', criteria: [{ title: 'x', points: 1, ratings: [{ label: 'x', points: 1 }] }] })).status === 403);
  const rubric = await teacher('POST', `/courses/${bio.id}/rubrics`, {
    title: 'Smoke rubric',
    criteria: [
      { title: 'Accuracy', points: 3, ratings: [{ label: 'Full', points: 3 }, { label: 'Partial', points: 1 }] },
      { title: 'Clarity', points: 2, ratings: [{ label: 'Clear', points: 2 }, { label: 'Unclear', points: 0 }] },
    ],
  });
  check('create a rubric', rubric.status === 201 && rubric.data.pointsPossible === 5, rubric.data);
  const rubricWork = await teacher('POST', `/courses/${bio.id}/activities`, { kind: 'offline', title: 'Smoke rubric work', points: 5 });
  try {
    await teacher('PATCH', `/activities/${rubricWork.data.id}`, { omitFromFinalGrade: true });
    await teacher('POST', `/activities/${rubricWork.data.id}/publish`);
    const attached = await teacher('PUT', `/activities/${rubricWork.data.id}/rubric`, { rubricId: rubric.data.id });
    check('attach the rubric', attached.status === 200 && attached.data.rubric?.id === rubric.data.id, attached.data);
    const [acc, cla] = rubric.data.criteria ?? [];
    const assessed = await ta('PUT', `/activities/${rubricWork.data.id}/submissions/${jordan.studentId}/rubric`, {
      assessments: [
        { criterionId: acc?.id, ratingId: acc?.ratings[0].id },
        { criterionId: cla?.id, ratingId: cla?.ratings[1].id, comment: 'Explain more' },
      ],
    });
    check('TA marks with the rubric: score is the sum', assessed.status === 200 && assessed.data.submission?.score === 3, assessed.data);
    const seen = await student('GET', `/portal/me/activities/${rubricWork.data.id}`);
    check('student sees the rubric and their levels', seen.data?.rubric?.criteria?.length === 2 && seen.data.rubricAssessment?.length === 2 && seen.data.submission?.score === 3, seen.data);
    check('an assessed rubric is frozen (409)', (await teacher('PATCH', `/courses/${bio.id}/rubrics/${rubric.data.id}`, { criteria: [{ title: 'x', points: 1, ratings: [{ label: 'x', points: 1 }] }] })).status === 409);
  } finally {
    // Marked work refuses an API delete; its submissions and rubric marks cascade.
    if (rubricWork.data?.id) await db.activity.delete({ where: { id: rubricWork.data.id } });
    if (rubric.data?.id) await teacher('DELETE', `/courses/${bio.id}/rubrics/${rubric.data.id}`);
  }

  // ── student portal ────────────────────────────────────────────────────────
  const myCourses = await student('GET', '/portal/me/courses');
  const bioCard = myCourses.data.find?.((c: any) => c.id === bio.id);
  check('portal course card has grade, no join code', bioCard?.grade?.percent === 73.03 && !('joinCode' in (bioCard ?? {})), bioCard);
  const grades = await student('GET', `/portal/me/courses/${bio.id}/grades`);
  check('portal grades: numbers', grades.status === 200 && isNum(grades.data.grade.percent), grades.data.grade);
  const todo = await student('GET', '/portal/me/activities');
  check('to-do has course names', todo.status === 200 && todo.data.every((a: any) => !!a.courseName), todo.data[0]);

  // ── calendar and new-work notices ─────────────────────────────────────────
  const day = 24 * 60 * 60 * 1000;
  const range = `from=${new Date(Date.now() - 30 * day).toISOString()}&to=${new Date(Date.now() + 30 * day).toISOString()}`;
  const staffCal = await teacher('GET', `/calendar?${range}`);
  check('staff calendar lists Biology due dates', staffCal.status === 200 && staffCal.data.some((i: any) => i.courseId === bio.id && !!i.dueAt), staffCal.data[0]);
  const myCal = await student('GET', `/portal/me/calendar?${range}`);
  check('student calendar: published only, with submission state', myCal.status === 200 && myCal.data.length > 0 && myCal.data.every((i: any) => i.status !== 'draft' && 'submission' in i), myCal.data[0]);
  const ics = await student('GET', `/portal/me/calendar/ics?${range}`);
  check('calendar .ics export', ics.status === 200 && String(ics.data).startsWith('BEGIN:VCALENDAR'), ics.status);
  check('calendar range is bounded (400)', (await teacher('GET', '/calendar?from=2026-01-01&to=2028-01-01')).status === 400);
  /** Notices are written after the request returns; give them a moment. */
  const noticeFor = async (match: (n: any) => boolean) => {
    for (let i = 0; i < 20; i++) {
      const r = await student('GET', '/portal/me/notifications?unread=true');
      const hit = r.data?.find?.(match);
      if (hit) return hit;
      await new Promise((res) => setTimeout(res, 150));
    }
    return null;
  };
  const draft = await teacher('POST', `/courses/${bio.id}/activities`, { kind: 'assignment', title: 'Smoke notice work', points: 5, dueAt: new Date(Date.now() + 3 * day).toISOString(), allowText: true });
  if (draft.data?.id) {
    try {
      const published = await teacher('POST', `/activities/${draft.data.id}/publish`);
      check('publish new work', published.status === 201 || published.status === 200, published.data);
      const notice = await noticeFor((n) => n.activityId === draft.data.id);
      check('student is notified of new work', !!notice && notice.courseId === bio.id, notice);
      const count = await student('GET', '/portal/me/notifications/unread-count');
      check('notification unread count', count.status === 200 && count.data.count >= 1, count.data);
      if (notice) {
        check('mark a notification read', (await student('POST', '/portal/me/notifications/read', { ids: [notice.id] })).status === 204);
        const after = await student('GET', '/portal/me/notifications?unread=true');
        check('read notice leaves the unread list', !after.data.some((n: any) => n.id === notice.id), after.data);
      }
    } finally {
      await teacher('DELETE', `/activities/${draft.data.id}`);
    }
  } else {
    check('create draft work', false, draft.data);
  }

  // ── attendance ────────────────────────────────────────────────────────────
  const open = await teacher('POST', `/courses/${bio.id}/attendance/sessions`, { durationMinutes: 5 });
  check('open attendance', open.status === 201 && /^\d{4}$/.test(open.data.checkInCode), open.data);
  const sid = open.data.id;
  try {
    const seen = await student('GET', '/portal/me/attendance/open');
    const mine = seen.data.find?.((s: any) => s.sessionId === sid);
    check('student sees it without the code', !!mine && !('checkInCode' in mine), mine);
    check('wrong code 409', (await student('POST', `/portal/me/attendance/${sid}/check-in`, { code: '0000' === open.data.checkInCode ? '1111' : '0000' })).status === 409);
    const byCode = await student('POST', `/portal/me/attendance/${sid}/check-in`, { code: open.data.checkInCode });
    check('check in by code', byCode.status === 200 && byCode.data.myStatus === 'present', byCode.data);
    const qr = await teacher('GET', `/courses/${bio.id}/attendance/sessions/${sid}/qr`);
    check('QR frame', qr.status === 200 && qr.data.url.includes(`/scan?s=${sid}`), qr.data);
    const byQr = await student2('POST', `/portal/me/attendance/${sid}/check-in`, { qrToken: qr.data.token });
    check('check in by QR', byQr.status === 200 && byQr.data.myStatus === 'present', byQr.data);
    const closed = await teacher('POST', `/courses/${bio.id}/attendance/sessions/${sid}/close`);
    check('close marks absentees', closed.status === 200 && closed.data.counts.absent === 10, closed.data.counts);
    const summary = await teacher('GET', `/courses/${bio.id}/attendance/summary`);
    check('attendance summary', summary.status === 200 && summary.data.sessionCount >= 1, summary.data.sessionCount);
  } finally {
    await teacher('DELETE', `/courses/${bio.id}/attendance/sessions/${sid}`);
  }

  // ── email domains and sign-in discovery ───────────────────────────────────
  const domains = await admin('GET', '/schools/email-domains');
  check('demo email domains verified', domains.status === 200 && domains.data.filter((d: any) => d.verified).length === 2, domains.data);
  const match = await fetch(`${API}/auth/sso/discover?email=someone@students.demo.test`, { headers: { 'X-API-Version': '1' } });
  check('sign-in discovery answers', match.status === 200);

  // ── announcements and chat ────────────────────────────────────────────────
  const ann = await student('GET', `/portal/me/courses/${bio.id}/announcements`);
  check('course announcements', ann.status === 200 && ann.data.length >= 2 && !!ann.data[0].author, ann.data[0]);
  const taPost = await ta('POST', `/courses/${bio.id}/announcements`, { title: 'Smoke TA post' });
  check('TA posts a course announcement', taPost.status === 201, taPost.data);
  if (taPost.data?.id) {
    const notice = await noticeFor((n) => n.announcementId === taPost.data.id);
    check('student is notified of the announcement', notice?.kind === 'announcement', notice);
    const path = `/courses/${bio.id}/announcements/${taPost.data.id}`;
    const edited = await teacher('PATCH', path, { title: 'Edited by teacher' });
    check("teacher edits a TA's announcement", edited.status === 200 && edited.data.title === 'Edited by teacher', edited.data);
    check("teacher deletes a TA's announcement", (await teacher('DELETE', path)).status === 200);
  }
  const unread = await teacher('GET', '/announcements/unread-count');
  check('announcement unread count is a number', unread.status === 200 && isNum(unread.data.count ?? unread.data), unread.data);

  // ── discussions ───────────────────────────────────────────────────────────
  const topic = await teacher('POST', `/courses/${bio.id}/discussions`, { title: 'Smoke topic', body: 'Say **hi**' });
  check('teacher starts a discussion', topic.status === 201 && !!topic.data.id, topic.data);
  if (topic.data?.id) {
    const portalTopic = `/portal/me/courses/${bio.id}/discussions/${topic.data.id}`;
    const posted = await student('POST', `${portalTopic}/replies`, { body: 'Hi from Jordan' });
    check('student replies', posted.status === 201 && posted.data.isMine === true, posted.data);
    const nested = await student2('POST', `${portalTopic}/replies`, { body: 'Hi back', parentId: posted.data.id });
    check('another student answers the reply', nested.status === 201 && nested.data.parentId === posted.data.id, nested.data);
    const seen = await student2('GET', portalTopic);
    const thread = seen.data.replies?.[0];
    check('other student sees the thread, no emails', seen.status === 200 && thread?.body === 'Hi from Jordan' && thread.replies.length === 1 && !JSON.stringify(seen.data).includes('@'), seen.data);
    const list = await student('GET', `/portal/me/courses/${bio.id}/discussions`);
    const row = list.data.topics?.find((t: any) => t.id === topic.data.id);
    check('topic list counts replies', row?.replyCount === 2 && row?.unreadCount === 1, row);
    check("student can't edit another student's post", (await student2('PATCH', `${portalTopic}/replies/${posted.data.id}`, { body: 'x' })).status === 403);
    check("student can't start a topic by default", (await student('POST', `/portal/me/courses/${bio.id}/discussions`, { title: 'x' })).status === 403);
    // A reply tells the topic's author: let students start topics for a moment.
    const settingsPath = `/courses/${bio.id}/discussions/settings`;
    let ownTopic: string | undefined;
    try {
      await teacher('PUT', settingsPath, { studentsCanCreateTopics: true });
      const mine = await student('POST', `/portal/me/courses/${bio.id}/discussions`, { title: 'Smoke student topic' });
      ownTopic = mine.data?.id;
      check('student starts a topic when allowed', mine.status === 201 && !!ownTopic, mine.data);
      if (ownTopic) {
        await student2('POST', `/portal/me/courses/${bio.id}/discussions/${ownTopic}/replies`, { body: 'First!' });
        await student2('POST', `/portal/me/courses/${bio.id}/discussions/${ownTopic}/replies`, { body: 'Second' });
        // Wait for the second reply's refresh of the same notice.
        const notice = await noticeFor((n) => n.kind === 'discussion_reply' && n.topicId === ownTopic && n.body?.includes('Second'));
        check('topic author is notified of replies (discussion_reply, topicId)', !!notice && notice.courseId === bio.id, notice);
        const all = (await student('GET', '/portal/me/notifications?unread=true')).data.filter((n: any) => n.topicId === ownTopic);
        check('replies coalesce into one unread notice', all.length === 1, all);
      }
    } finally {
      await teacher('PUT', settingsPath, { studentsCanCreateTopics: false });
      if (ownTopic) await teacher('DELETE', `/courses/${bio.id}/discussions/${ownTopic}`);
    }
    const removed = await teacher('DELETE', `/courses/${bio.id}/discussions/${topic.data.id}/replies/${posted.data.id}`);
    const after = await student('GET', portalTopic);
    check('teacher deletes a reply; its thread stays', removed.status === 204 && after.data.replies?.[0]?.isDeleted === true && after.data.replies[0].replies.length === 1, after.data.replies);
    check('teacher deletes the topic', (await teacher('DELETE', `/courses/${bio.id}/discussions/${topic.data.id}`)).status === 204);
  }

  // A topic in a module: students see the item only once the topic is published.
  const draftTopic = await teacher('POST', `/courses/${bio.id}/discussions`, { title: 'Smoke module topic', isPublished: false });
  const topicModule = modules.data.find((m: any) => m.isPublished);
  if (draftTopic.data?.id && topicModule) {
    try {
      const added = await teacher('POST', `/courses/${bio.id}/modules/${topicModule.id}/items`, { itemType: 'discussion', discussionTopicId: draftTopic.data.id });
      check('add a discussion module item', added.status === 201 && added.data.itemType === 'discussion' && added.data.discussionTopicId === draftTopic.data.id && added.data.title === 'Smoke module topic', added.data);
      const studentItems = async () => ((await student('GET', `/portal/me/courses/${bio.id}/modules`)).data as any[]).flatMap((m) => m.items);
      check('student does not see a draft topic item', !(await studentItems()).some((i) => i.discussionTopicId === draftTopic.data.id));
      await teacher('PATCH', `/courses/${bio.id}/discussions/${draftTopic.data.id}`, { isPublished: true });
      check('student sees the item once the topic is published', (await studentItems()).some((i) => i.itemType === 'discussion' && i.discussionTopicId === draftTopic.data.id));
      const told = await noticeFor((n) => n.kind === 'discussion_topic' && n.topicId === draftTopic.data.id);
      check('student is notified of the published topic', !!told, told);
    } finally {
      // The item goes with the topic.
      await teacher('DELETE', `/courses/${bio.id}/discussions/${draftTopic.data.id}`);
    }
    check('topic delete takes its module item', (await db.module_item.count({ where: { discussion_topic_id: draftTopic.data.id } })) === 0);
  } else {
    check('draft topic and a published module', false, draftTopic.data);
  }

  // ── course copy and templates ─────────────────────────────────────────────
  const teacher2 = await login('teacher2@demo.test');
  const made: string[] = [];
  try {
    const copy = await teacher('POST', `/courses/${bio.id}/copy`, { name: 'Smoke Biology copy', code: 'BIO-S', shiftDays: 7 });
    check('copy Biology 101', copy.status === 201 && copy.data.status === 'draft' && copy.data.role === 'teacher' && !copy.data.joinCode, copy.data);
    if (copy.data?.id) {
      made.push(copy.data.id);
      const counts = (courseId: string) => Promise.all([
        db.module.count({ where: { course_id: courseId } }),
        db.module_item.count({ where: { course_id: courseId } }),
        db.activity.count({ where: { course_id: courseId } }),
        db.rubric.count({ where: { course_id: courseId } }),
        db.discussion_topic.count({ where: { course_id: courseId, user_profile: { account_type: { not: 'student' } } } }),
      ]);
      const [from, to] = await Promise.all([counts(bio.id), counts(copy.data.id)]);
      check('copy has the same modules/items/activities/rubrics/topics', JSON.stringify(from) === JSON.stringify(to) && to[0] > 0 && to[2] > 0, { from, to });
      check('copy has no students or submissions', (await db.course_student.count({ where: { course_id: copy.data.id } })) === 0 && (await db.submission.count({ where: { activity: { course_id: copy.data.id } } })) === 0);
      const items = await db.module_item.findMany({ where: { course_id: copy.data.id, item_type: 'activity' }, select: { activity: { select: { course_id: true, status: true } } } });
      check('copied items point at the copied draft activities', items.length > 0 && items.every((i) => i.activity?.course_id === copy.data.id && i.activity?.status === 'draft'), items.length);
      const due = await db.activity.findFirst({ where: { course_id: bio.id, due_at: { not: null } }, select: { title: true, due_at: true } });
      const moved = due && await db.activity.findFirst({ where: { course_id: copy.data.id, title: due.title }, select: { due_at: true } });
      check('due dates shifted by 7 days', !due || moved?.due_at?.getTime() === due.due_at!.getTime() + 7 * 86_400_000, { due, moved });

      check('TA cannot copy (403)', (await ta('POST', `/courses/${bio.id}/copy`, { name: 'x' })).status === 403);
      check('teacher2 cannot copy a non-template (404)', (await teacher2('POST', `/courses/${bio.id}/copy`, { name: 'x' })).status === 404);
      const flagged = await teacher('PATCH', `/courses/${copy.data.id}`, { isTemplate: true });
      check('flag the copy as a template', flagged.status === 200 && flagged.data.isTemplate === true, flagged.data);
      check('a course with students cannot be a template (409)', (await teacher('PATCH', `/courses/${bio.id}`, { isTemplate: true })).status === 409);
      const templates = await teacher2('GET', '/courses/templates');
      check('teacher2 lists school templates', templates.status === 200 && templates.data.some((t: any) => t.id === copy.data.id && t.moduleCount > 0), templates.data);
      const fromTemplate = await teacher2('POST', `/courses/${copy.data.id}/copy`, { name: 'Smoke from template', clearDueDates: true });
      check('teacher2 creates a course from the template', fromTemplate.status === 201 && fromTemplate.data.role === 'teacher' && fromTemplate.data.isTemplate === false && fromTemplate.data.copied?.activities === to[2], fromTemplate.data);
      if (fromTemplate.data?.id) made.push(fromTemplate.data.id);
      check('template refuses a join code (400)', (await teacher('POST', `/courses/${copy.data.id}/join-code`)).status === 400);
      await db.course.update({ where: { id: copy.data.id }, data: { status: 'published', join_code: 'SMKTPL' } });
      check('template rejects joining (404)', (await student('POST', '/portal/me/courses/join', { joinCode: 'SMKTPL' })).status === 404);
      check('template refuses enrolment (400)', (await teacher('POST', `/courses/${copy.data.id}/students`, { studentIds: [people.data.students[0].studentId] })).status === 400);
    }

    // Import Biology's content into a fresh scratch course.
    const scratch = await teacher('POST', '/courses', { name: 'Smoke import target' });
    if (scratch.data?.id) {
      made.push(scratch.data.id);
      const before = await db.module.count({ where: { course_id: scratch.data.id } });
      const imported = await teacher('POST', `/courses/${scratch.data.id}/import`, { sourceCourseId: bio.id, clearDueDates: true });
      const after = await db.module.count({ where: { course_id: scratch.data.id } });
      check('import content adds the modules', (imported.status === 201 || imported.status === 200) && imported.data.copied?.modules > 0 && after === before + imported.data.copied.modules, { status: imported.status, data: imported.data, before, after });
      const topicItems = await db.module_item.findMany({ where: { course_id: scratch.data.id, item_type: 'discussion' }, select: { discussion_topic: { select: { course_id: true } } } });
      check('imported discussion items point at the imported topics', topicItems.length > 0 && topicItems.every((i) => i.discussion_topic?.course_id === scratch.data.id), topicItems.length);
    } else {
      check('create a scratch course', false, scratch.data);
    }
  } finally {
    for (const id of made) await admin('DELETE', `/courses/${id}`);
  }
  check('copied courses cleaned up', (await db.course.count({ where: { id: { in: made } } })) === 0);

  // ── billing (hosted platform only) ────────────────────────────────────────
  // Runs the full flow when the API has BILLING_ENABLED=true; otherwise checks
  // that every billing and platform route is absent.
  const billingStatus = await teacher('GET', '/billing/status');
  check('billing status answers', billingStatus.status === 200 && typeof billingStatus.data?.enabled === 'boolean', billingStatus.data);
  const webhookPost = (provider: string) =>
    fetch(`${API}/billing/webhooks/${provider}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!billingStatus.data?.enabled) {
    check('billing off: status reports nothing', billingStatus.data?.readOnly === false && billingStatus.data?.status === null, billingStatus.data);
    check('billing off: /billing is 404', (await admin('GET', '/billing')).status === 404);
    check('billing off: /billing/checkout is 404', (await admin('POST', '/billing/checkout', { plan: 'flat', provider: 'stripe' })).status === 404);
    check('billing off: /platform/me is 404', (await admin('GET', '/platform/me')).status === 404);
    check('billing off: /platform/overview is 404', (await admin('GET', '/platform/overview')).status === 404);
    check('billing off: webhooks are 404', (await webhookPost('stripe')).status === 404);
  } else {
    const schoolId: string = me.data.school.id;
    const snapshot = await db.subscription.findUnique({ where: { school_id: schoolId } });
    const invoicesBefore = new Set((await db.invoice.findMany({ where: { school_id: schoolId }, select: { id: true } })).map((i) => i.id));
    const smokeCourses: string[] = [];
    try {
      check('billing on: school is writable (trialing/active)', ['trialing', 'active'].includes(billingStatus.data.status) && billingStatus.data.readOnly === false, billingStatus.data);
      const studentStatus = await student('GET', '/billing/status');
      check('student sees billing status', studentStatus.status === 200 && studentStatus.data.enabled === true && studentStatus.data.readOnly === false, studentStatus.data);
      check('teacher cannot open school billing (403)', (await teacher('GET', '/billing')).status === 403);
      const summary = await admin('GET', '/billing');
      check('admin billing summary', summary.status === 200 && summary.data.billableUsers > 0 && summary.data.prices?.perUserCents > 0 && Array.isArray(summary.data.providers) && typeof summary.data.paymentsConfigured === 'boolean', summary.data);
      // Stripe is the only provider: nothing else is ever offered.
      check('only Stripe can be offered', summary.data.providers.every((p: any) => p.id === 'stripe') && summary.data.paymentsConfigured === summary.data.providers.length > 0, summary.data.providers);
      if (!summary.data.paymentsConfigured) {
        // No Stripe keys on this deployment: checkout says so clearly instead of failing obscurely.
        const notConfigured = await admin('POST', '/billing/checkout', { plan: 'flat' });
        check('checkout without Stripe configured is 503 with a clear message', notConfigured.status === 503 && /not configured/i.test(String(notConfigured.data?.message ?? '')), notConfigured.data);
        check('Stripe webhook without Stripe configured (404)', (await webhookPost('stripe')).status === 404);
      } else {
        check('unsigned Stripe webhook is rejected (400)', (await webhookPost('stripe')).status === 400);
        check('unknown provider at checkout (400)', (await admin('POST', '/billing/checkout', { plan: 'flat', provider: 'nope' })).status === 400);
        // A real checkout needs Stripe's hosted page; drive it by hand in the
        // Stripe sandbox (backend/src/billing/STRIPE.md, step 8).
      }
      for (const removed of ['manual', 'wipay', 'paypal', 'paddle']) {
        const res = await admin('POST', '/billing/checkout', { plan: 'per_user', provider: removed });
        check(`removed provider "${removed}" is refused at checkout`, res.status === 400 || res.status === 503, res.data);
      }
      check('pay-invoice route is gone (404)', (await admin('POST', `/billing/invoices/${crypto.randomUUID()}/pay`, { provider: 'stripe' })).status === 404);
      const schoolInvoices = await admin('GET', '/billing/invoices');
      check('school invoices list', schoolInvoices.status === 200 && Array.isArray(schoolInvoices.data), schoolInvoices.data);

      check('the removed manual provider has no webhook (404)', (await webhookPost('manual')).status === 404);
      check('the removed WiPay provider has no webhook (404)', (await webhookPost('wipay')).status === 404);
      check('webhook browser-return GET is gone (404)', (await fetch(`${API}/billing/webhooks/stripe`)).status === 404);
      check('unknown provider webhook (404)', (await webhookPost('nope')).status === 404);

      const teacherMe = await teacher('GET', '/platform/me');
      check('teacher is not a platform admin', teacherMe.status === 200 && teacherMe.data.isPlatformAdmin === false, teacherMe.data);
      check('non-admin gets 404 on /platform/overview', (await teacher('GET', '/platform/overview')).status === 404);
      check('non-admin gets 404 on /platform/invoices', (await student('GET', '/platform/invoices')).status === 404);
      const adminMe = await admin('GET', '/platform/me');
      check('admin@demo.test is a platform admin', adminMe.data?.isPlatformAdmin === true, adminMe.data);
      const overview = await admin('GET', '/platform/overview');
      check('platform overview', overview.status === 200 && overview.data.schools > 0 && overview.data.paymentsConfigured === summary.data.paymentsConfigured && !('openInvoices' in overview.data), overview.data);
      const platformSchools = await admin('GET', `/platform/schools?search=${encodeURIComponent((me.data.school.name ?? '').slice(0, 4))}`);
      check('platform schools search finds the demo school', platformSchools.status === 200 && platformSchools.data.some?.((s: any) => s.schoolId === schoolId && typeof s.billableUsers === 'number'), platformSchools.data);
      const openList = await admin('GET', '/platform/invoices?status=open');
      check('platform lists open invoices', openList.status === 200 && Array.isArray(openList.data) && openList.data.every((i: any) => i.status === 'open' && !!i.schoolId), openList.data?.length);
      // Invoice-mode machinery and the provider switches are gone.
      check('invoice sweep route is gone (404)', (await admin('POST', '/platform/invoices/generate')).status === 404);
      check('void route is gone (404)', (await admin('POST', `/platform/invoices/${crypto.randomUUID()}/void`, {})).status === 404);
      check('platform providers page is gone (404)', (await admin('GET', '/platform/providers')).status === 404);
      check('provider switch is gone (404)', (await admin('PATCH', '/platform/providers/stripe', { enabled: true })).status === 404);

      check('offline mark-paid is gone (404)', (await admin('POST', `/platform/invoices/${crypto.randomUUID()}/mark-paid`, { method: 'bank_transfer' })).status === 404);
      const detail = await admin('GET', `/platform/schools/${schoolId}`);
      check('platform school detail has invoices', detail.status === 200 && Array.isArray(detail.data.invoices), detail.data?.invoices?.length);

      // Lapse the school: trial over, nothing paid. The comp call with a past
      // date changes nothing but flushes the cached entitlement.
      await db.subscription.update({ where: { school_id: schoolId }, data: { status: 'trialing', plan: null, provider: null, trial_ends_at: new Date(Date.now() - 86_400_000), current_period_end: null, comp_until: null } });
      await admin('POST', `/platform/schools/${schoolId}/comp`, { until: '2000-01-01', note: 'smoke' });
      const lapsed = await teacher('GET', '/billing/status');
      check('lapsed school is read-only', lapsed.data?.readOnly === true && lapsed.data.status === 'read_only', lapsed.data);
      const blocked = await teacher('POST', '/courses', { name: 'Smoke blocked course' });
      if (blocked.data?.id) smokeCourses.push(blocked.data.id);
      check('teacher POST is refused with 402 SUBSCRIPTION_REQUIRED', blocked.status === 402 && blocked.data?.code === 'SUBSCRIPTION_REQUIRED' && blocked.data?.statusCode === 402, blocked);
      check('student POST is refused with 402', (await student('POST', '/portal/me/courses/join', { joinCode: 'NOPE00' })).status === 402);
      check('reads still work while read-only', (await teacher('GET', '/courses')).status === 200);
      check('billing still works while read-only', (await admin('GET', '/billing')).data?.readOnly === true);
      check('marking notices read still works', (await student('POST', '/portal/me/notifications/read-all')).status !== 402);

      const extended = await admin('POST', `/platform/schools/${schoolId}/extend-trial`, { days: 1 });
      check('platform admin extends the trial', extended.status === 200 && extended.data.readOnly === false && extended.data.status === 'trialing', extended.data);
      const allowed = await teacher('POST', '/courses', { name: 'Smoke unblocked course' });
      if (allowed.data?.id) smokeCourses.push(allowed.data.id);
      check('teacher can write again', allowed.status === 201, allowed.status);

      // Lapse again, then recover with a comp instead.
      await db.subscription.update({ where: { school_id: schoolId }, data: { trial_ends_at: new Date(Date.now() - 86_400_000) } });
      await admin('POST', `/platform/schools/${schoolId}/comp`, { until: '2000-01-01', note: 'smoke' });
      check('lapsed again is read-only', (await teacher('GET', '/billing/status')).data?.readOnly === true);
      const comped = await admin('POST', `/platform/schools/${schoolId}/comp`, { until: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), note: 'smoke' });
      check('platform admin comps the school', comped.status === 200 && comped.data.readOnly === false, comped.data);
      check('comped school is writable', (await teacher('GET', '/billing/status')).data?.readOnly === false);
    } finally {
      for (const id of smokeCourses) await admin('DELETE', `/courses/${id}`);
      await db.invoice.deleteMany({ where: { school_id: schoolId, id: { notIn: [...invoicesBefore] } } });
      if (snapshot) {
        const { id: _id, school_id: _school, ...fields } = snapshot;
        await db.subscription.update({ where: { school_id: schoolId }, data: fields });
      }
      // The API caches each school's entitlement for a minute; with Redis,
      // drop it so the restored row is what the next request sees.
      if (process.env.USE_REDIS === 'true' && process.env.REDIS_URL) {
        const redis = new (await import('bun')).RedisClient(process.env.REDIS_URL);
        await redis.del(`billing:ent:${schoolId}`).catch(() => undefined);
        redis.close();
      }
    }
    check('billing state restored', (await db.invoice.count({ where: { school_id: schoolId, id: { notIn: [...invoicesBefore] } } })) === 0 && (await teacher('GET', '/billing/status')).data?.readOnly === false);
  }

  // ── GDPR erasure log, retention purge and replay ──────────────────────────
  await erasureChecks(teacher, ta);

  // ── Signed-in devices, token rotation, reuse detection (signs the TA out) ─
  await sessionChecks(teacher, admin);

  await db.$disconnect();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Sign in without the cookie-jar helper: returns the raw token (cookie or X-Session-Token). */
async function rawSignIn(email: string, extra: Record<string, string> = {}) {
  const headers = { 'content-type': 'application/json', 'X-API-Version': '1', ...extra };
  const { code } = (await (await fetch(`${API}/auth/dev/code`, { method: 'POST', headers, body: JSON.stringify({ email }) })).json()) as { code: string };
  const res = await fetch(`${API}/auth/otp/verify`, { method: 'POST', headers, body: JSON.stringify({ email, token: code }) });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('gb_session='));
  return { status: res.status, cookieToken: cookie?.slice('gb_session='.length), headerToken: res.headers.get('x-session-token') };
}

/** One request with a session token, as the web (cookie) or the app (bearer). */
async function withToken(token: string, via: 'cookie' | 'bearer', method: string, path: string) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      'X-API-Version': '1',
      ...(via === 'cookie' ? { cookie: `gb_session=${token}` } : { authorization: `Bearer ${token}`, 'X-GradeBook-Client': 'native' }),
    },
  });
  const text = await r.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, data, newToken: r.headers.get('x-session-token'), setCookie: r.headers.getSetCookie().join('; ') };
}

/** Mailpit (local SMTP catcher): messages to `to` whose subject contains `subject`, if Mailpit is running. */
async function mailpit(to: string, subject: string, since: Date): Promise<any[] | null> {
  const base = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
  try {
    const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=50`);
    if (!res.ok) return null;
    const { messages } = (await res.json()) as { messages: any[] };
    return messages.filter((m) => String(m.Subject).includes(subject) && new Date(m.Created) >= since);
  } catch {
    return null;
  }
}

/**
 * Signed-in devices and session hardening, as the TA (whose sessions all end
 * here, so it runs last): listing and revoking sessions, the native token
 * header, the daily token rotation with its grace period, reuse detection
 * (session revoked, email sent), and an admin signing a member out.
 */
async function sessionChecks(teacher: Call, admin: Call) {
  const email = 'ta@demo.test';
  const [{ now: since }] = await db.$queryRaw<{ now: Date }[]>`SELECT now() - interval '2 seconds' AS now`;
  const created: string[] = [];
  const a = await rawSignIn(email);
  const b = await rawSignIn(email);
  check('sessions: two web sign-ins', !!a.cookieToken && !!b.cookieToken && a.cookieToken !== b.cookieToken, [a.status, b.status]);
  if (!a.cookieToken || !b.cookieToken) return;
  const list = await withToken(a.cookieToken, 'cookie', 'GET', '/auth/sessions');
  const current = list.data?.find?.((s: any) => s.current);
  created.push(...(list.data ?? []).map((s: any) => s.id));
  check('sessions: list marks this device, has device/IP/times, no hashes', list.status === 200 && list.data.length >= 2 && !!current?.device && 'ip' in current && !!current.lastSeenAt && !!current.expiresAt && !JSON.stringify(list.data).includes('token'), list.data);

  // The app: a token in a header, a device label from X-GradeBook-Device.
  const device = `Smoke Phone ${Date.now()} · TestOS 1`;
  // A user agent of its own too: sessions from before device labels match on it.
  const n = await rawSignIn(email, { 'X-GradeBook-Client': 'native', 'X-GradeBook-Device': device, 'User-Agent': `SmokeApp/${Date.now()}` });
  check('sessions: native client receives X-Session-Token', n.status === 201 && !!n.headerToken, n.status);
  if (!n.headerToken) return;
  const row = await db.session.findFirst({ where: { user_id: (await withToken(a.cookieToken, 'cookie', 'GET', '/auth/me')).data.id, device: { contains: 'Smoke Phone' } }, orderBy: { created_at: 'desc' } });
  check('sessions: app labelled from X-GradeBook-Device', row?.device === `GradeBook app on ${device.replace(' · ', ' (')})`, row?.device);
  if (!row) return;
  created.push(row.id);

  // Rotation: a day since the last renewal, then one request.
  await db.session.update({ where: { id: row.id }, data: { last_seen_at: new Date(Date.now() - 25 * 3_600_000) } });
  const rotated = await withToken(n.headerToken, 'bearer', 'GET', '/auth/me');
  const t1 = rotated.newToken;
  check('rotation: the renewing response carries a new token', rotated.status === 200 && !!t1 && t1 !== n.headerToken, rotated.status);
  if (!t1) return;
  const grace = await withToken(n.headerToken, 'bearer', 'GET', '/auth/me');
  check('rotation: the old token works within the grace period (and gets the new one again)', grace.status === 200 && grace.newToken === t1, [grace.status, grace.newToken === t1]);
  check('rotation: the new token works', (await withToken(t1, 'bearer', 'GET', '/auth/me')).status === 200);
  await db.session.update({ where: { id: row.id }, data: { rotated_at: new Date(Date.now() - 10 * 60_000) } });
  const reused = await withToken(n.headerToken, 'bearer', 'GET', '/auth/me');
  const after = await db.session.findUnique({ where: { id: row.id } });
  check('reuse: the old token after the grace period is 401 and revokes the session', reused.status === 401 && !!after?.revoked_at && after.revoked_reason === 'token_reuse', [reused.status, after?.revoked_reason]);
  check('reuse: the current token dies with it (no cache delay)', (await withToken(t1, 'bearer', 'GET', '/auth/me')).status === 401);

  // revoke-others, someone else's session, revoking the current one.
  const others = await withToken(a.cookieToken, 'cookie', 'POST', '/auth/sessions/revoke-others');
  check('sessions: revoke-others', others.status === 200 && others.data.revoked >= 1, others.data);
  check('sessions: the other device is signed out at once', (await withToken(b.cookieToken, 'cookie', 'GET', '/auth/me')).status === 401);
  check('sessions: this device still works', (await withToken(a.cookieToken, 'cookie', 'GET', '/auth/me')).status === 200);
  const teacherSession = (await teacher('GET', '/auth/sessions')).data?.find?.((s: any) => s.current)?.id;
  check("sessions: someone else's session is 404", !!teacherSession && (await withToken(a.cookieToken, 'cookie', 'DELETE', `/auth/sessions/${teacherSession}`)).status === 404, teacherSession);
  const own = await withToken(a.cookieToken, 'cookie', 'DELETE', `/auth/sessions/${current.id}`);
  check('sessions: revoking this device clears the cookie', own.status === 200 && own.data.current === true && /gb_session=;/.test(own.setCookie), [own.status, own.setCookie]);
  check('sessions: revoked current session is 401 afterwards', (await withToken(a.cookieToken, 'cookie', 'GET', '/auth/me')).status === 401);

  // An admin signs a member out of every device.
  const c = await rawSignIn(email);
  const members = await admin('GET', '/schools/members');
  const taId = row.user_id;
  const membership = members.data?.find?.((m: any) => m.user?.id === taId)?.id;
  const byAdmin = membership ? await admin('POST', `/schools/members/${membership}/sessions/revoke`) : null;
  check('admin: sign a member out everywhere', byAdmin?.status === 200 && byAdmin.data.revoked >= 1, byAdmin?.data);
  check("admin: the member's session is 401 at once", !!c.cookieToken && (await withToken(c.cookieToken, 'cookie', 'GET', '/auth/me')).status === 401);
  check('admin: a teacher (not an admin) cannot (403)', !!membership && (await teacher('POST', `/schools/members/${membership}/sessions/revoke`)).status === 403);

  // Security emails, when Mailpit is running.
  await Bun.sleep(500);
  const newSignIn = await mailpit(email, 'New sign-in to GradeBook', since);
  const reuseMail = await mailpit(email, 'Suspicious activity', since);
  if (newSignIn === null) console.log('SKIP  security emails (Mailpit not reachable)');
  else {
    check('email: new sign-in alert for the new app device', newSignIn.length >= 1, newSignIn.map((m) => m.Subject));
    check('email: token reuse alert', (reuseMail?.length ?? 0) >= 1, reuseMail?.map((m) => m.Subject));
  }

  // Clean up: the sessions made here are all ended; drop them.
  const ended = await db.session.deleteMany({ where: { user_id: taId, created_at: { gte: since }, revoked_at: { not: null } } });
  await db.known_device.deleteMany({ where: { user_id: taId, first_seen_at: { gte: since } } });
  check('sessions: cleaned up', ended.count >= created.length, ended.count);
}

/** Run a backend CLI script; returns its exit code and output. */
async function cli(script: string, args: string[]) {
  const proc = Bun.spawn(['bun', 'run', `scripts/${script}`, ...args], { cwd: `${__dirname}/..`, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out: out + err };
}

/**
 * Deleting a file and a chat message writes erasure-log entries; the purge
 * CLI (0-day retention, limited to these two rows) removes them for good;
 * then a simulated restore (rows and log entries put back as they were
 * before) is undone by `erasure:replay --since`, reading the log from its
 * object-storage copy, and a second replay changes nothing. Leaves the
 * erasure-log entries in place - the log is append-only.
 */
async function erasureChecks(teacher: Call, ta: Call) {
  const [{ now: since }] = await db.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  const teacherId = (await teacher('GET', '/auth/me')).data.id as string;
  const taId = (await ta('GET', '/auth/me')).data.id as string;
  const form = new FormData();
  form.append('file', new Blob(['erase me'], { type: 'text/plain' }), 'smoke-erasure.txt');
  const up = await teacher('POST', '/files?name=smoke-erasure.txt', form);
  const conv = await teacher('POST', '/chat/conversations', { userId: taId });
  const msg = conv.data?.id ? await teacher('POST', `/chat/conversations/${conv.data.id}/messages`, { body: 'smoke erasure message' }) : conv;
  check('erasure: fixtures (file, chat message)', up.status === 201 && msg.status === 201, [up.data, msg.data]);
  const fileId: string | undefined = up.data?.id;
  const msgId: string | undefined = msg.data?.id;
  if (!fileId || !msgId) return;
  const fileBefore = await db.file.findUniqueOrThrow({ where: { id: fileId } });
  const msgBefore = await db.message.findUniqueOrThrow({ where: { id: msgId } });

  check('erasure: delete the file', (await teacher('DELETE', `/files/${fileId}`)).status === 200);
  check('erasure: delete the chat message', (await teacher('DELETE', `/chat/messages/${msgId}`)).status === 200);
  const logged = await db.erasure_log.findMany({ where: { occurred_at: { gte: since }, subject_ids: { hasSome: [fileId, msgId] } }, orderBy: { occurred_at: 'asc' } });
  const fileEntry = logged.find((e) => e.kind === 'file' && e.subject_ids.includes(fileId));
  const msgEntry = logged.find((e) => e.kind === 'chat_message' && e.subject_ids.includes(msgId));
  check('erasure: file delete logged (user_request, by the teacher)', fileEntry?.reason === 'user_request' && fileEntry.actor === teacherId && fileEntry.school_id === fileBefore.school_id, fileEntry);
  check('erasure: chat delete logged', msgEntry?.reason === 'user_request' && msgEntry.actor === teacherId, msgEntry);
  check('erasure: log holds no personal data', !JSON.stringify(logged).includes('smoke-erasure') && !JSON.stringify(logged).includes('smoke erasure message'), logged);

  const dry = await cli('retention-purge.ts', ['--dry-run', '--retention-days', '0', '--only', `${fileId},${msgId}`]);
  check('purge --dry-run counts and changes nothing', dry.code === 0 && /files\s+1\b/.test(dry.out) && (await db.file.count({ where: { id: fileId } })) === 1, dry.out);
  const purged = await cli('retention-purge.ts', ['--retention-days', '0', '--only', `${fileId},${msgId}`]);
  check('purge (0-day retention, these rows only) succeeds', purged.code === 0, purged.out);
  check('purge removed the file row and the chat message row', (await db.file.count({ where: { id: fileId } })) === 0 && (await db.message.count({ where: { id: msgId } })) === 0);
  const storage = new StorageService();
  const key = `${fileBefore.bucket}/${fileBefore.storage_path}`;
  check('purge removed the stored object', (await storage.exists(key)) === null, key);
  const purgeEntries = await db.erasure_log.findMany({ where: { reason: 'retention_purge', occurred_at: { gte: since }, subject_ids: { hasSome: [fileId, msgId] } } });
  check('purge logged as retention_purge', purgeEntries.length === 2 && purgeEntries.every((e) => e.actor === 'system'), purgeEntries);

  // Simulated restore of a backup taken before the deletes: the rows come
  // back as they were, and the log loses the entries written since.
  const ours = [...logged, ...purgeEntries].map((e) => e.id);
  for (let i = 0; i < 20 && (await db.erasure_log.count({ where: { id: { in: ours }, exported_at: null } })) > 0; i++) await Bun.sleep(500);
  check('erasure log copied to object storage', (await db.erasure_log.count({ where: { id: { in: ours }, exported_at: null } })) === 0);
  await db.erasure_log.deleteMany({ where: { id: { in: ours } } });
  await db.file.create({ data: { ...fileBefore, deleted_at: null } });
  await db.message.create({ data: { ...msgBefore, metadata: msgBefore.metadata ?? {} } as any });

  const replayed = await cli('erasure-replay.ts', ['--since', since.toISOString()]);
  check('erasure:replay re-applies the erasures from the storage copy', replayed.code === 0 && /Summary: .* 0 failed/.test(replayed.out), replayed.out);
  check('replay removed the restored rows again', (await db.file.count({ where: { id: fileId } })) === 0 && (await db.message.count({ where: { id: msgId } })) === 0);
  check('replay put the entries back in the log', (await db.erasure_log.count({ where: { id: { in: ours } } })) === ours.length);
  const again = await cli('erasure-replay.ts', ['--since', since.toISOString()]);
  check('a second replay changes nothing', again.code === 0 && /Summary: \d+ unique entr\w+, 0 applied, \d+ unchanged, 0 failed/.test(again.out), again.out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
