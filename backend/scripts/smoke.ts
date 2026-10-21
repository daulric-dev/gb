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
 */
import { createClient } from '@supabase/supabase-js';

const API = `${(process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '')}/api`;
const AUTH_URL = process.env.AUTH_ADMIN_URL ?? 'http://127.0.0.1:54321';
// The fixed service-role key every local auth stack uses; only for minting
// sign-in codes until our own auth replaces it.
const AUTH_ADMIN_KEY =
  process.env.AUTH_ADMIN_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const authAdmin = createClient(AUTH_URL, AUTH_ADMIN_KEY, { auth: { persistSession: false } });

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
  const { data, error } = await authAdmin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const res = await fetch(`${API}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Version': '1' },
    body: JSON.stringify({ email, token: data.properties!.email_otp }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        cookie,
        'X-API-Version': '1',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
  check('terms: weights are numbers', terms.status === 200 && isNum(terms.data[0]?.exam_weight), terms.data[0]);
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

  // ── student portal ────────────────────────────────────────────────────────
  const myCourses = await student('GET', '/portal/me/courses');
  const bioCard = myCourses.data.find?.((c: any) => c.id === bio.id);
  check('portal course card has grade, no join code', bioCard?.grade?.percent === 73.03 && !('joinCode' in (bioCard ?? {})), bioCard);
  const grades = await student('GET', `/portal/me/courses/${bio.id}/grades`);
  check('portal grades: numbers', grades.status === 200 && isNum(grades.data.grade.percent), grades.data.grade);
  const todo = await student('GET', '/portal/me/activities');
  check('to-do has course names', todo.status === 200 && todo.data.every((a: any) => !!a.courseName), todo.data[0]);

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
  const unread = await teacher('GET', '/announcements/unread-count');
  check('announcement unread count is a number', unread.status === 200 && isNum(unread.data.count ?? unread.data), unread.data);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
