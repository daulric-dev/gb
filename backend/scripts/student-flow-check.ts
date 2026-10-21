import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// API_URL is the API origin, as in .env.example; routes live under /api.
const API = `${(process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '')}/api`;
// Fixtures go straight to the database; sign-in goes through the API.
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const results: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

/** Minimal cookie jar: the backend authenticates by cookie, not bearer. */
class Session {
  private cookies = new Map<string, string>();

  private header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(res: Response) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1));
    }
  }

  async fetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.header() ? { cookie: this.header() } : {}),
        ...(init.headers ?? {}),
      },
    });
    this.absorb(res);
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body };
  }
}

/**
 * A sign-in code from the API's dev-only endpoint (ALLOW_DEV_LOGIN=true)
 * instead of mail. It is a real code, so /auth/otp/verify - and everything
 * downstream of it - is still exercised for real.
 */
async function mintOtp(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/dev/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`dev code for ${email} -> ${res.status} (is ALLOW_DEV_LOGIN=true?)`);
  return ((await res.json()) as { code: string }).code;
}

async function main() {
  const stamp = Date.now();
  const studentEmail = `http-stu-${stamp}@t.test`;

  // ---- fixtures straight into the database --------------------------------
  const staffUser = await db.app_user.create({
    data: { email: `http-staff-${stamp}@t.test`, email_verified_at: new Date() },
    select: { id: true },
  });
  const staffId = staffUser.id;

  const school = await db.school.create({
    data: { name: `HTTP E2E ${stamp}` },
    select: { id: true },
  });
  const schoolId = school.id;

  await db.user_profile.upsert({
    where: { id: staffId },
    create: {
      id: staffId,
      first_name: 'Staff',
      school_id: schoolId,
      role: 'admin',
      account_type: 'staff',
    },
    update: {
      first_name: 'Staff',
      school_id: schoolId,
      role: 'admin',
      account_type: 'staff',
    },
  });
  await db.school_management.create({
    data: { user_id: staffId, school_id: schoolId, role: 'admin' },
  });

  const year = await db.academic_year.create({
    data: { school_id: schoolId, name: '2026/27', is_active: true },
    select: { id: true },
  });
  const term = await db.term.create({
    data: { academic_year_id: year.id, name: 'Semester 1', sort_order: 1 },
    select: { id: true },
  });

  const me = await db.student.create({
    data: { school_id: schoolId, first_name: 'Sam', last_name: 'Self' },
    select: { id: true },
  });
  const other = await db.student.create({
    data: { school_id: schoolId, first_name: 'Class', last_name: 'Mate' },
    select: { id: true },
  });

  // A published course with a join code. `other` is enrolled; `me` joins over
  // HTTP below.
  const joinCode = `J${String(stamp).slice(-5)}`;
  const course = await db.course.create({
    data: {
      school_id: schoolId,
      academic_year_id: year.id,
      term_id: term.id,
      name: 'Maths',
      code: 'MAT',
      status: 'published',
      join_code: joinCode,
      created_by: staffId,
    },
    select: { id: true },
  });
  await db.course_staff.create({
    data: { course_id: course.id, user_profile_id: staffId, role: 'teacher' },
  });
  await db.course_student.create({
    data: { course_id: course.id, student_id: other.id },
  });

  const activity = await db.activity.create({
    data: {
      course_id: course.id,
      kind: 'offline',
      title: 'Test 1',
      points: 100,
      status: 'published',
      created_by: staffId,
    },
    select: { id: true },
  });
  await db.submission.createMany({
    data: [
      { activity_id: activity.id, student_id: me.id, status: 'graded', score: 77 },
      { activity_id: activity.id, student_id: other.id, status: 'graded', score: 12 },
    ],
  });

  // Content: one published module with a published page, and a draft page
  // that must stay hidden.
  const page = await db.page.create({
    data: { course_id: course.id, title: 'Welcome', body: '# Hi', is_published: true },
    select: { id: true },
  });
  const draftPage = await db.page.create({
    data: { course_id: course.id, title: 'Draft', body: 'wip' },
    select: { id: true },
  });
  const mod = await db.module.create({
    data: { course_id: course.id, title: 'Week 1', is_published: true },
    select: { id: true },
  });
  await db.module_item.createMany({
    data: [
      { module_id: mod.id, course_id: course.id, position: 0, item_type: 'page', page_id: page.id },
      { module_id: mod.id, course_id: course.id, position: 1, item_type: 'page', page_id: draftPage.id },
    ],
  });

  // ---- staff issues a claim code over HTTP --------------------------------
  const staffSession = new Session();
  const staffOtp = await mintOtp(`http-staff-${stamp}@t.test`);
  const staffVerify = await staffSession.fetch('/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ email: `http-staff-${stamp}@t.test`, token: staffOtp }),
  });
  check('staff logs in over HTTP', staffVerify.status === 201 || staffVerify.status === 200, `status ${staffVerify.status}`);

  const issued = await staffSession.fetch(`/students/${me!.id}/claim-code`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  check('staff issues a claim code over HTTP', issued.status === 201 && typeof issued.body?.code === 'string', `status ${issued.status} ${JSON.stringify(issued.body).slice(0, 80)}`);
  const claimCode: string = issued.body.code;

  // ---- the student's own journey ------------------------------------------
  // The first sign-in creates the account and the backend creates the
  // user_profile.
  const student = new Session();
  const otp = await mintOtp(studentEmail);
  const verify = await student.fetch('/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ email: studentEmail, token: otp }),
  });
  check('student logs in over HTTP', verify.status === 200 || verify.status === 201, `status ${verify.status}`);
  check('new login reports account_type staff by default', verify.body?.user?.account_type === 'staff', JSON.stringify(verify.body?.user?.account_type));

  // portal is closed before claiming
  const earlyPortal = await student.fetch('/portal/me');
  check('portal denied before onboarding', earlyPortal.status === 403, `status ${earlyPortal.status}`);

  const onboard = await student.fetch('/auth/onboard', {
    method: 'PATCH',
    body: JSON.stringify({ firstName: 'Sam', lastName: 'Self', accountType: 'student' }),
  });
  check('student onboards as a student', onboard.status === 200 && onboard.body?.account_type === 'student', `status ${onboard.status} type ${onboard.body?.account_type}`);

  const stillClosed = await student.fetch('/portal/me');
  check('portal still denied before the code is redeemed', stillClosed.status === 403, `status ${stillClosed.status}`);

  const badCode = await student.fetch('/auth/claim-student', {
    method: 'POST',
    body: JSON.stringify({ code: 'AAAA-BBBB-CCCC' }),
  });
  check('a wrong code is rejected', badCode.status === 400, `status ${badCode.status}`);

  const claim = await student.fetch('/auth/claim-student', {
    method: 'POST',
    body: JSON.stringify({ code: claimCode }),
  });
  check('student redeems the real code', claim.status === 201 && claim.body?.studentId === me!.id, `status ${claim.status} ${JSON.stringify(claim.body).slice(0, 80)}`);

  // ---- portal reads --------------------------------------------------------
  const portalMe = await student.fetch('/portal/me');
  check('GET /portal/me returns the student', portalMe.status === 200 && portalMe.body?.firstName === 'Sam', `status ${portalMe.status}`);

  const before = await student.fetch('/portal/me/courses');
  check('no courses before joining', before.status === 200 && Array.isArray(before.body) && before.body.length === 0, JSON.stringify(before.body).slice(0, 80));

  const hidden = await student.fetch(`/portal/me/courses/${course!.id}`);
  check('a course the student is not in is a 404', hidden.status === 404, `status ${hidden.status}`);

  const wrongJoin = await student.fetch('/portal/me/courses/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode: 'NOPE00' }),
  });
  check('a wrong join code is rejected', wrongJoin.status === 404, `status ${wrongJoin.status}`);

  const joined = await student.fetch('/portal/me/courses/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode: joinCode.toLowerCase() }),
  });
  check('student joins the course by code', joined.status === 201 && joined.body?.id === course!.id, `status ${joined.status} ${JSON.stringify(joined.body).slice(0, 80)}`);
  check('the course card never carries the join code', joined.body && !('joinCode' in joined.body), JSON.stringify(Object.keys(joined.body ?? {})));

  const courses = await student.fetch('/portal/me/courses');
  const card = Array.isArray(courses.body) ? courses.body[0] : null;
  check('the course lists with its teacher', courses.status === 200 && courses.body.length === 1 && card?.teachers?.[0]?.firstName === 'Staff', JSON.stringify(card).slice(0, 120));
  check('the card grade is the caller-only mark', card?.grade?.percent === 77, JSON.stringify(card?.grade));

  const modules = await student.fetch(`/portal/me/courses/${course!.id}/modules`);
  const items: any[] = modules.body?.[0]?.items ?? [];
  check('modules show published items only', modules.status === 200 && items.length === 1 && items[0].title === 'Welcome', JSON.stringify(items.map((i) => i.title)));

  const readPage = await student.fetch(`/portal/me/courses/${course!.id}/pages/${page!.id}`);
  check('a published page is readable', readPage.status === 200 && readPage.body?.body === '# Hi', `status ${readPage.status}`);

  const readDraft = await student.fetch(`/portal/me/courses/${course!.id}/pages/${draftPage!.id}`);
  check('a draft page is a 404', readDraft.status === 404, `status ${readDraft.status}`);

  const news = await student.fetch(`/portal/me/courses/${course!.id}/announcements`);
  check('course announcements respond', news.status === 200 && Array.isArray(news.body), `status ${news.status}`);

  // ---- a student must not reach the staff API -----------------------------
  for (const [label, path] of [
    ['students roster', '/students'],
    ['staff dashboard', '/dashboard/summary'],
    ['school members', '/schools/members'],
    ['permission catalog', '/permissions/catalog'],
  ] as const) {
    const res = await student.fetch(path);
    check(`student denied ${label}`, res.status === 403, `status ${res.status}`);
  }

  const mine = await student.fetch('/permissions/me');
  check('permissions/me reports a student with no permissions',
    mine.status === 200 && mine.body?.accountType === 'student' && mine.body?.permissions?.length === 0,
    JSON.stringify(mine.body),
  );

  // ---- a second claim of the same code fails ------------------------------
  const replay = await student.fetch('/auth/claim-student', {
    method: 'POST',
    body: JSON.stringify({ code: claimCode }),
  });
  check('the code cannot be replayed', replay.status === 409 || replay.status === 400, `status ${replay.status}`);

  console.log('\n' + results.join('\n') + '\n');
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error('SCRIPT ERROR', e);
    process.exit(1);
  });
