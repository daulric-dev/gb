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
        // Only with a body: Fastify rejects an empty JSON body (bodiless
        // POST / DELETE would otherwise be a 400).
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
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

/** Sign in through the real OTP flow; the session cookie lands in `session`. */
async function signIn(session: Session, email: string) {
  const token = await mintOtp(email);
  return session.fetch('/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ email, token }),
  });
}

/** Rows in the tables this script writes to, to prove clean-up. */
async function counts() {
  const [school, app_user, student] = await Promise.all([
    db.school.count(),
    db.app_user.count(),
    db.student.count(),
  ]);
  return { school, app_user, student };
}

const short = (v: unknown, n = 100) => JSON.stringify(v)?.slice(0, n);

async function main() {
  const stamp = Date.now();
  const staffEmail = `http-staff-${stamp}@t.test`;
  const studentEmail = `http-stu-${stamp}@t.test`;
  const student2Email = `http-stu2-${stamp}@t.test`;
  const emails = [staffEmail, studentEmail, student2Email];

  // Everything created is recorded here so `finally` can remove it even when a
  // step throws half-way through.
  let schoolId: string | null = null;

  const before = await counts();

  try {
    // ---- fixtures straight into the database ------------------------------
    const staffUser = await db.app_user.create({
      data: { email: staffEmail, email_verified_at: new Date() },
      select: { id: true },
    });
    const staffId = staffUser.id;

    const school = await db.school.create({
      data: { name: `HTTP E2E ${stamp}` },
      select: { id: true },
    });
    schoolId = school.id;

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

    // The classmate is a fixture; the student under test gets their record
    // only by redeeming the school join code over HTTP below.
    const other = await db.student.create({
      data: { school_id: schoolId, first_name: 'Class', last_name: 'Mate' },
      select: { id: true },
    });

    // A published course with a join code. `other` is enrolled; the student
    // joins over HTTP below.
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
    await db.submission.create({
      data: { activity_id: activity.id, student_id: other.id, status: 'graded', score: 12 },
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

    // ---- staff issues the school join code over HTTP ----------------------
    const staff = new Session();
    const staffVerify = await signIn(staff, staffEmail);
    check('staff logs in over HTTP', staffVerify.status === 201 || staffVerify.status === 200, `status ${staffVerify.status}`);

    const noCode = await staff.fetch('/schools/join-code');
    check('no live join code to start with', noCode.status === 200 && noCode.body?.activeCode === null, `status ${noCode.status} ${short(noCode.body)}`);

    const issued = await staff.fetch('/schools/join-code', {
      method: 'POST',
      body: JSON.stringify({ ttlDays: 7 }),
    });
    const schoolCode: string = issued.body?.code;
    check('staff issues the school join code',
      issued.status === 201 && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(schoolCode ?? '') && typeof issued.body?.expiresAt === 'string',
      `status ${issued.status} ${short(issued.body)}`,
    );

    const status = await staff.fetch('/schools/join-code');
    check('code status is active and never shows the code',
      status.status === 200 && !!status.body?.activeCode?.expiresAt && !JSON.stringify(status.body).includes(schoolCode),
      short(status.body),
    );

    // ---- the student's own journey ----------------------------------------
    // The first sign-in creates the account and the backend creates the
    // user_profile.
    const student = new Session();
    const verify = await signIn(student, studentEmail);
    check('student logs in over HTTP', verify.status === 200 || verify.status === 201, `status ${verify.status}`);
    check('new login reports account_type staff by default', verify.body?.user?.account_type === 'staff', short(verify.body?.user?.account_type));
    check('new login is not onboarded', verify.body?.user?.is_onboarded === false, short(verify.body?.user?.is_onboarded));

    // portal is closed before joining
    const earlyPortal = await student.fetch('/portal/me');
    check('portal denied before onboarding', earlyPortal.status === 403, `status ${earlyPortal.status}`);

    const onboard = await student.fetch('/auth/onboard', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'Sam', lastName: 'Self', accountType: 'student' }),
    });
    check('student onboards as a student', onboard.status === 200 && onboard.body?.account_type === 'student', `status ${onboard.status} type ${onboard.body?.account_type}`);
    // @t.test is no school's verified email domain, so onboarding must not
    // auto-join anywhere: the code is the only way in.
    check('onboarding does not place the student in a school', onboard.body?.school === null, short(onboard.body?.school));

    const asStaff = await student.fetch('/auth/onboard', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'Sam', lastName: 'Self', accountType: 'staff' }),
    });
    check('a student account cannot re-onboard as staff', asStaff.status === 403, `status ${asStaff.status}`);

    const stillClosed = await student.fetch('/portal/me');
    check('portal still denied before the code is redeemed', stillClosed.status === 403, `status ${stillClosed.status}`);

    const badCode = await student.fetch('/auth/join-school', {
      method: 'POST',
      body: JSON.stringify({ code: 'AAAA-BBBB-CCCC' }),
    });
    check('a wrong code is rejected', badCode.status === 400, `status ${badCode.status}`);

    const shortCode = await student.fetch('/auth/join-school', {
      method: 'POST',
      body: JSON.stringify({ code: 'ABCD' }),
    });
    check('a wrong-length code is rejected the same way', shortCode.status === 400 && shortCode.body?.message === badCode.body?.message, `status ${shortCode.status} ${short(shortCode.body?.message)}`);

    // Case and dashes are ignored.
    const joinSchool = await student.fetch('/auth/join-school', {
      method: 'POST',
      body: JSON.stringify({ code: schoolCode.toLowerCase().replace(/-/g, '') }),
    });
    const joinedId: string | undefined = joinSchool.body?.studentId;
    check('student redeems the school code',
      joinSchool.status === 201 && joinSchool.body?.schoolId === schoolId && typeof joinedId === 'string',
      `status ${joinSchool.status} ${short(joinSchool.body)}`,
    );
    const record = joinedId
      ? await db.student.findUnique({
          where: { id: joinedId },
          select: { first_name: true, last_name: true, user_profile_id: true },
        })
      : null;
    check('redeeming creates the record from the profile, linked to the login',
      record?.first_name === 'Sam' && record?.last_name === 'Self' && record?.user_profile_id === verify.body?.user?.id,
      short(record),
    );

    const fresh = await student.fetch('/portal/me');
    check('portal opens on the new record', fresh.status === 200 && fresh.body?.id === joinedId && fresh.body?.school?.id === schoolId, `status ${fresh.status} ${short(fresh.body)}`);

    const replay = await student.fetch('/auth/join-school', {
      method: 'POST',
      body: JSON.stringify({ code: schoolCode }),
    });
    check('joining a second school is refused', replay.status === 409, `status ${replay.status}`);

    // The code is not consumed: a second student can use it too.
    const student2 = new Session();
    await signIn(student2, student2Email);
    await student2.fetch('/auth/onboard', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'Nia', lastName: 'New', accountType: 'student' }),
    });
    const join2 = await student2.fetch('/auth/join-school', {
      method: 'POST',
      body: JSON.stringify({ code: schoolCode }),
    });
    check('the code stays valid for the next student', join2.status === 201 && join2.body?.schoolId === schoolId, `status ${join2.status} ${short(join2.body)}`);

    // ---- staff see the student; nobody creates one ------------------------
    const roster = await staff.fetch('/students');
    check('the joined student is on the roster',
      roster.status === 200 && Array.isArray(roster.body) && roster.body.some((r: any) => r.id === joinedId),
      `status ${roster.status} ${short(roster.body, 200)}`,
    );

    const create = await staff.fetch('/students', {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Made', lastName: 'Up', gender: 'male' }),
    });
    check('staff cannot create a student record (no such route)', create.status === 404, `status ${create.status}`);

    // A mark recorded against the joined record, as a teacher would after the
    // student is in the course; the portal must show it to them alone.
    await db.submission.create({
      data: { activity_id: activity.id, student_id: joinedId!, status: 'graded', score: 77 },
    });

    // ---- portal reads -----------------------------------------------------
    const portalMe = await student.fetch('/portal/me');
    check('GET /portal/me returns the joined record', portalMe.status === 200 && portalMe.body?.id === joinedId && portalMe.body?.firstName === 'Sam', `status ${portalMe.status} ${short(portalMe.body)}`);

    const none = await student.fetch('/portal/me/courses');
    check('no courses before joining', none.status === 200 && Array.isArray(none.body) && none.body.length === 0, short(none.body));

    const hidden = await student.fetch(`/portal/me/courses/${course.id}`);
    check('a course the student is not in is a 404', hidden.status === 404, `status ${hidden.status}`);

    const wrongJoin = await student.fetch('/portal/me/courses/join', {
      method: 'POST',
      body: JSON.stringify({ joinCode: 'NOPE00' }),
    });
    check('a wrong course join code is rejected', wrongJoin.status === 404, `status ${wrongJoin.status}`);

    const joined = await student.fetch('/portal/me/courses/join', {
      method: 'POST',
      body: JSON.stringify({ joinCode: joinCode.toLowerCase() }),
    });
    check('student joins the course by code', joined.status === 201 && joined.body?.id === course.id, `status ${joined.status} ${short(joined.body)}`);
    check('the course card never carries the join code', !!joined.body && !('joinCode' in joined.body), short(Object.keys(joined.body ?? {})));

    const courses = await student.fetch('/portal/me/courses');
    const card = Array.isArray(courses.body) ? courses.body[0] : null;
    check('the course lists with its teacher', courses.status === 200 && courses.body.length === 1 && card?.teachers?.[0]?.firstName === 'Staff', short(card, 120));
    check('the card grade is the caller-only mark', card?.grade?.percent === 77, short(card?.grade));

    const grades = await student.fetch(`/portal/me/courses/${course.id}/grades`);
    const scores = (grades.body?.activities ?? []).map((a: any) => a.submission?.score);
    check('the grades page shows only the caller\'s score',
      grades.status === 200 && grades.body?.grade?.percent === 77 && scores.length === 1 && scores[0] === 77,
      `status ${grades.status} ${short(scores)}`,
    );

    const modules = await student.fetch(`/portal/me/courses/${course.id}/modules`);
    const items: any[] = modules.body?.[0]?.items ?? [];
    check('modules show published items only', modules.status === 200 && items.length === 1 && items[0].title === 'Welcome', short(items.map((i) => i.title)));

    const readPage = await student.fetch(`/portal/me/courses/${course.id}/pages/${page.id}`);
    check('a published page is readable', readPage.status === 200 && readPage.body?.body === '# Hi', `status ${readPage.status}`);

    const readDraft = await student.fetch(`/portal/me/courses/${course.id}/pages/${draftPage.id}`);
    check('a draft page is a 404', readDraft.status === 404, `status ${readDraft.status}`);

    const news = await student.fetch(`/portal/me/courses/${course.id}/announcements`);
    check('course announcements respond', news.status === 200 && Array.isArray(news.body), `status ${news.status}`);

    // ---- a student must not reach the staff API ---------------------------
    for (const [label, path] of [
      ['students roster', '/students'],
      ['staff dashboard', '/dashboard/summary'],
      ['school members', '/schools/members'],
      ['permission catalog', '/permissions/catalog'],
      ['join code status', '/schools/join-code'],
    ] as const) {
      const res = await student.fetch(path);
      check(`student denied ${label}`, res.status === 403, `status ${res.status}`);
    }

    const mine = await student.fetch('/permissions/me');
    check('permissions/me reports a student with no permissions',
      mine.status === 200 && mine.body?.accountType === 'student' && mine.body?.permissions?.length === 0,
      short(mine.body),
    );

    // ---- revoking the code closes the door --------------------------------
    const revoke = await staff.fetch('/schools/join-code', { method: 'DELETE' });
    check('staff revokes the join code', revoke.status === 204, `status ${revoke.status}`);

    const afterRevoke = await staff.fetch('/schools/join-code');
    check('no live code after revoking', afterRevoke.status === 200 && afterRevoke.body?.activeCode === null, short(afterRevoke.body));

    // The code is checked before membership, so a revoked code reads as
    // invalid rather than "already in a school".
    const revoked = await student.fetch('/auth/join-school', {
      method: 'POST',
      body: JSON.stringify({ code: schoolCode }),
    });
    check('a revoked code is rejected', revoked.status === 400, `status ${revoked.status}`);
  } finally {
    // ---- clean-up -----------------------------------------------------------
    // The school cascades to its years, terms, courses (and their content,
    // enrolments, activities, submissions), students, join codes, memberships
    // and billing rows. Accounts are not under the school: deleting app_user
    // cascades to user_profile, sessions and identities. Sign-in codes are
    // keyed by email only.
    if (schoolId) await db.school.delete({ where: { id: schoolId } }).catch((e) => console.error('clean-up school', e));
    await db.app_user.deleteMany({ where: { email: { in: emails } } }).catch((e) => console.error('clean-up app_user', e));
    await db.email_code.deleteMany({ where: { email: { in: emails } } }).catch((e) => console.error('clean-up email_code', e));

    const after = await counts();
    check('clean-up leaves the row counts as they were',
      JSON.stringify(after) === JSON.stringify(before),
      `before ${short(before)} after ${short(after)}`,
    );

    console.log('\n' + results.join('\n') + '\n');
  }
}

main()
  .catch((e) => {
    console.error('SCRIPT ERROR', e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
