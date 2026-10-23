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
    const item = await teacher('POST', `/courses/${bio.id}/modules/${publishedModule.id}/items`, { itemType: 'file', fileId });
    check('link the file in a module', item.status === 201, item.data);
    const opened = await student('GET', portalFile);
    check('student opens the module file', opened.status === 200 && opened.data === 'smoke', opened.status);
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
    const removed = await teacher('DELETE', `/courses/${bio.id}/discussions/${topic.data.id}/replies/${posted.data.id}`);
    const after = await student('GET', portalTopic);
    check('teacher deletes a reply; its thread stays', removed.status === 204 && after.data.replies?.[0]?.isDeleted === true && after.data.replies[0].replies.length === 1, after.data.replies);
    check('teacher deletes the topic', (await teacher('DELETE', `/courses/${bio.id}/discussions/${topic.data.id}`)).status === 204);
  }

  await db.$disconnect();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
