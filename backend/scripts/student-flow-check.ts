import { createClient } from '@supabase/supabase-js';

// API_URL is the API origin, as in .env.example; routes live under /api.
const API = `${(process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '')}/api`;
const SUPA = 'http://127.0.0.1:54321';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(SUPA, SERVICE_KEY, { auth: { persistSession: false } });

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
 * Mint the OTP through the admin API instead of sending mail. Local Supabase
 * caps outbound email at 2/hour, which makes a mail-based flow unrepeatable.
 * The token is the same one the email would carry, so /auth/otp/verify - and
 * everything downstream of it - is still exercised for real.
 */
async function mintOtp(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error) throw error;
  const otp = data.properties?.email_otp;
  if (!otp) throw new Error(`No email_otp returned for ${email}`);
  return otp;
}

async function main() {
  const stamp = Date.now();
  const studentEmail = `http-stu-${stamp}@t.test`;

  // ---- fixtures via the service client ------------------------------------
  const { data: staffUser } = await admin.auth.admin.createUser({
    email: `http-staff-${stamp}@t.test`,
    email_confirm: true,
  });
  const staffId = staffUser.user!.id;

  const { data: school } = await admin
    .from('school')
    .insert({ name: `HTTP E2E ${stamp}` })
    .select('id')
    .single();
  const schoolId = school!.id;

  await admin.from('user_profile').upsert({
    id: staffId,
    first_name: 'Staff',
    school_id: schoolId,
    role: 'admin',
    account_type: 'staff',
  });
  await admin
    .from('school_management')
    .insert({ user_id: staffId, school_id: schoolId, role: 'admin' });

  const { data: year } = await admin
    .from('academic_year')
    .insert({ school_id: schoolId, name: '2026/27', is_active: true })
    .select('id')
    .single();
  const { data: term } = await admin
    .from('term')
    .insert({ academic_year_id: year!.id, name: 'Semester 1', sort_order: 1 })
    .select('id')
    .single();

  const { data: me } = await admin
    .schema('student')
    .from('student')
    .insert({ school_id: schoolId, first_name: 'Sam', last_name: 'Self' })
    .select('id')
    .single();
  const { data: other } = await admin
    .schema('student')
    .from('student')
    .insert({ school_id: schoolId, first_name: 'Class', last_name: 'Mate' })
    .select('id')
    .single();

  // A published course with a join code. `other` is enrolled; `me` joins over
  // HTTP below.
  const joinCode = `J${String(stamp).slice(-5)}`;
  const { data: course } = await admin
    .schema('course')
    .from('course')
    .insert({
      school_id: schoolId,
      academic_year_id: year!.id,
      term_id: term!.id,
      name: 'Maths',
      code: 'MAT',
      status: 'published',
      join_code: joinCode,
      created_by: staffId,
    })
    .select('id')
    .single();
  await admin
    .schema('course')
    .from('course_staff')
    .insert({ course_id: course!.id, user_profile_id: staffId, role: 'teacher' });
  await admin
    .schema('course')
    .from('course_student')
    .insert({ course_id: course!.id, student_id: other!.id });

  const { data: activity } = await admin
    .schema('grading')
    .from('activity')
    .insert({
      course_id: course!.id,
      kind: 'offline',
      title: 'Test 1',
      points: 100,
      status: 'published',
      created_by: staffId,
    })
    .select('id')
    .single();
  await admin.schema('grading').from('submission').insert([
    { activity_id: activity!.id, student_id: me!.id, status: 'graded', score: 77 },
    { activity_id: activity!.id, student_id: other!.id, status: 'graded', score: 12 },
  ]);

  // Content: one published module with a published page, and a draft page
  // that must stay hidden.
  const { data: page } = await admin
    .schema('course')
    .from('page')
    .insert({ course_id: course!.id, title: 'Welcome', body: '# Hi', is_published: true })
    .select('id')
    .single();
  const { data: draftPage } = await admin
    .schema('course')
    .from('page')
    .insert({ course_id: course!.id, title: 'Draft', body: 'wip' })
    .select('id')
    .single();
  const { data: mod } = await admin
    .schema('course')
    .from('module')
    .insert({ course_id: course!.id, title: 'Week 1', is_published: true })
    .select('id')
    .single();
  await admin.schema('course').from('module_item').insert([
    { module_id: mod!.id, course_id: course!.id, position: 0, item_type: 'page', page_id: page!.id },
    { module_id: mod!.id, course_id: course!.id, position: 1, item_type: 'page', page_id: draftPage!.id },
  ]);

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
  // Normally signInWithOtp creates this user; created here so the admin API
  // can mint a token for it. The backend still creates the user_profile.
  await admin.auth.admin.createUser({ email: studentEmail, email_confirm: true });

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

main().catch((e) => {
  console.error('SCRIPT ERROR', e);
  process.exit(1);
});
