import { createClient } from '@supabase/supabase-js';

const API = process.env.API_URL ?? 'http://127.0.0.1:3001/api';
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
    .insert({ academic_year_id: year!.id, name: 'michaelmas', sort_order: 1 })
    .select('id')
    .single();
  const { data: group } = await admin
    .from('student_group')
    .insert({ academic_year_id: year!.id, name: 'Form 1' })
    .select('id')
    .single();
  const { data: subject } = await admin
    .from('subject')
    .insert({ school_id: schoolId, name: 'Maths', code: 'MAT' })
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

  await admin
    .schema('student')
    .from('student_group_enrollment')
    .insert({ student_id: me!.id, student_group_id: group!.id });

  const { data: asmt } = await admin
    .schema('grading')
    .from('assessment')
    .insert({
      subject_id: subject!.id,
      term_id: term!.id,
      title: 'Test 1',
      assessment_type: 'exam',
      max_score: 100,
      weight: 1,
      assessment_date: '2026-09-15',
    })
    .select('id')
    .single();

  await admin.schema('grading').from('grade').insert([
    { assessment_id: asmt!.id, student_id: me!.id, score: 77 },
    { assessment_id: asmt!.id, student_id: other!.id, score: 12 },
  ]);

  await admin.schema('student').from('attendance_record').insert([
    { student_id: me!.id, student_group_id: group!.id, attendance_date: '2026-09-01', status: 'present' },
    { student_id: other!.id, student_group_id: group!.id, attendance_date: '2026-09-01', status: 'absent' },
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
  check('portal shows the class enrolment', portalMe.body?.classes?.length === 1, JSON.stringify(portalMe.body?.classes?.length));

  const grades = await student.fetch('/portal/me/grades');
  const gradeRows: any[] = Array.isArray(grades.body) ? grades.body : [];
  const scores = gradeRows.flatMap((s: any) => s.assessments.map((a: any) => a.score));
  check('grades are the caller-only rows', grades.status === 200 && scores.length === 1 && scores[0] === 77, `${JSON.stringify(scores)}`);

  const attendance = await student.fetch('/portal/me/attendance');
  check('attendance is caller-only', attendance.status === 200 && attendance.body?.summary?.total === 1, JSON.stringify(attendance.body?.summary));

  const reports = await student.fetch('/portal/me/reports');
  check('reports endpoint responds', reports.status === 200 && Array.isArray(reports.body), `status ${reports.status}`);

  // ---- a student must not reach the staff API -----------------------------
  for (const [label, path] of [
    ['students roster', '/students'],
    ['classes', '/classes'],
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
