/**
 * Demo data for trying the course LMS locally.
 *
 *   bun run seed:demo            create the demo school (refuses if it exists)
 *   bun run seed:demo --fresh    delete the demo school and accounts first
 *   bun run seed:demo otp <email>  print a login code without sending mail
 *
 * Needs the local Supabase stack (`bun run db:start` at the root) and the API
 * running on :3001 (`bun run start:dev`). Accounts, the school and its roster
 * go in through the service client - that is what onboarding would have done.
 * Everything course-shaped goes through the real API as the teacher or
 * student who would do it, so seeding also exercises the endpoints.
 *
 * Local Supabase sends at most two emails an hour, so log in with the `otp`
 * mode rather than asking the login page to email a code.
 */
import { createClient } from '@supabase/supabase-js';

// API_URL is the API origin, as in .env.example; routes live under /api.
const API = `${(process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '')}/api`;
const SUPA = 'http://127.0.0.1:54321';
// The fixed service-role key every local Supabase stack uses.
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const SCHOOL_NAME = 'Riverside Academy';
const DOMAIN = 'demo.test';

const db = createClient(SUPA, SERVICE_KEY, { auth: { persistSession: false } });

// ── helpers ─────────────────────────────────────────────────────────────────

async function mintOtp(email: string): Promise<string> {
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const otp = data.properties?.email_otp;
  if (!otp) throw new Error(`No email_otp returned for ${email}`);
  return otp;
}

/** Minimal cookie jar: the backend authenticates by cookie, not bearer. */
class Session {
  private cookies = new Map<string, string>();

  constructor(readonly email: string) {}

  private header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async login() {
    const token = await mintOtp(this.email);
    await this.call('POST', '/auth/otp/verify', { email: this.email, token });
    return this;
  }

  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'X-API-Version': '1',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookies.size ? { cookie: this.header() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1));
    }
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
    }
    return data as T;
  }
}

// Untyped like the rest of the service-client code: the client carries no
// Database generic, so rows come back as `any` either way.
function must(
  result: { data: any; error: { message: string } | null },
  what: string,
): any {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? 'no data'}`);
  }
  return result.data;
}

function daysFromNow(days: number, hour = 23, minute = 59) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

// ── people ──────────────────────────────────────────────────────────────────

const STAFF = [
  { key: 'admin', first: 'Grace', last: 'Okafor', role: 'admin' },
  { key: 'teacher', first: 'Maya', last: 'Patel', role: 'teacher' },
  { key: 'teacher2', first: 'Leo', last: 'Brooks', role: 'teacher' },
  { key: 'ta', first: 'Ana', last: 'Ruiz', role: 'teacher' },
] as const;

// The first three have logins; the rest are roster-only, as most students are
// before they claim an account.
const STUDENTS = [
  { first: 'Jordan', last: 'Lee', email: `student@${DOMAIN}` },
  { first: 'Priya', last: 'Shah', email: `student2@${DOMAIN}` },
  { first: 'Marcus', last: 'Bell', email: `student3@${DOMAIN}` },
  { first: 'Chloe', last: 'Martin' },
  { first: 'Diego', last: 'Santos' },
  { first: 'Amara', last: 'Nwosu' },
  { first: 'Ethan', last: 'Clarke' },
  { first: 'Hana', last: 'Sato' },
  { first: 'Isaac', last: 'Freeman' },
  { first: 'Lucia', last: 'Romero' },
  { first: 'Noah', last: 'Kim' },
  { first: 'Zara', last: 'Ali' },
] as const;

async function createUser(email: string) {
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`create ${email}: ${error.message}`);
  return data.user!.id;
}

async function wipe() {
  const { data: school } = await db.from('school').select('id').eq('name', SCHOOL_NAME).maybeSingle();
  if (school) {
    // owner_id is ON DELETE RESTRICT, so the school goes before its owner.
    await db.from('school').delete().eq('id', school.id);
  }
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list?.users ?? []) {
    if (u.email?.endsWith(`@${DOMAIN}`)) {
      await db.from('user_profile').delete().eq('id', u.id);
      await db.auth.admin.deleteUser(u.id);
    }
  }
  console.log('Removed the previous demo school and accounts.');
}

// ── main ────────────────────────────────────────────────────────────────────

async function seed() {
  const existing = await db.from('school').select('id').eq('name', SCHOOL_NAME).maybeSingle();
  if (existing.data) {
    throw new Error(`"${SCHOOL_NAME}" already exists. Re-run with --fresh to replace it.`);
  }

  // Staff accounts and the school they run.
  const staffIds: Record<string, string> = {};
  for (const s of STAFF) staffIds[s.key] = await createUser(`${s.key}@${DOMAIN}`);

  for (const s of STAFF) {
    must(
      await db
        .from('user_profile')
        .insert({
          id: staffIds[s.key],
          first_name: s.first,
          last_name: s.last,
          email: `${s.key}@${DOMAIN}`,
          role: s.role,
          account_type: 'staff',
        })
        .select('id'),
      `profile ${s.key}`,
    );
  }

  const school = must(
    await db
      .from('school')
      .insert({ name: SCHOOL_NAME, code: 'RVA', school_type: 'secondary', owner_id: staffIds.admin })
      .select('id')
      .single(),
    'school',
  );

  for (const s of STAFF) {
    must(
      await db.from('user_profile').update({ school_id: school.id }).eq('id', staffIds[s.key]).select('id'),
      `school for ${s.key}`,
    );
    must(
      await db
        .from('school_management')
        .insert({ user_id: staffIds[s.key], school_id: school.id, role: s.role })
        .select('id'),
      `membership ${s.key}`,
    );
  }

  const year = must(
    await db
      .from('academic_year')
      .insert({
        school_id: school.id,
        name: '2026/27',
        start_date: '2026-09-01',
        end_date: '2027-06-30',
        is_active: true,
        grading_model: 'weighted_continuous',
      })
      .select('id')
      .single(),
    'academic year',
  );

  const terms = must(
    await db
      .from('term')
      .insert([
        { academic_year_id: year.id, name: 'Fall 2026', start_date: '2026-09-01', end_date: '2026-12-18', sort_order: 1, exam_weight: 50, coursework_weight: 50 },
        { academic_year_id: year.id, name: 'Spring 2027', start_date: '2027-01-06', end_date: '2027-06-30', sort_order: 2, exam_weight: 50, coursework_weight: 50 },
      ])
      .select('id, name'),
    'terms',
  );
  const fall = terms.find((t: any) => t.name === 'Fall 2026')!;

  // Students: a roster record each, plus a login for the first three.
  const studentIds: string[] = [];
  for (const s of STUDENTS) {
    let profileId: string | null = null;
    if ('email' in s) {
      profileId = await createUser(s.email);
      must(
        await db
          .from('user_profile')
          .insert({
            id: profileId,
            school_id: school.id,
            first_name: s.first,
            last_name: s.last,
            email: s.email,
            account_type: 'student',
          })
          .select('id'),
        `student profile ${s.email}`,
      );
    }
    const rec = must(
      await db
        .schema('student')
        .from('student')
        .insert({
          school_id: school.id,
          first_name: s.first,
          last_name: s.last,
          user_profile_id: profileId,
          enrollment_date: '2026-09-01',
        })
        .select('id')
        .single(),
      `student ${s.first}`,
    );
    studentIds.push(rec.id);
  }
  const [jordan, priya, marcus] = studentIds;

  console.log('Accounts and roster created. Building courses through the API...');

  const admin = await new Session(`admin@${DOMAIN}`).login();
  const maya = await new Session(`teacher@${DOMAIN}`).login();
  const leo = await new Session(`teacher2@${DOMAIN}`).login();

  await admin.call('POST', '/grade-scales', {
    name: 'Letter grades',
    scaleType: 'letter',
    isDefault: true,
    bands: [
      { label: 'A', minPercentage: 90, maxPercentage: 100, isPass: true, sortOrder: 0 },
      { label: 'B', minPercentage: 80, maxPercentage: 89.99, isPass: true, sortOrder: 1 },
      { label: 'C', minPercentage: 70, maxPercentage: 79.99, isPass: true, sortOrder: 2 },
      { label: 'D', minPercentage: 60, maxPercentage: 69.99, isPass: true, sortOrder: 3 },
      { label: 'F', minPercentage: 0, maxPercentage: 59.99, isPass: false, sortOrder: 4 },
    ],
  });

  // ── Biology 101: the full tour ────────────────────────────────────────────
  const bio = await maya.call('POST', '/courses', {
    name: 'Biology 101',
    code: 'BIO-101',
    description:
      'An introduction to living systems: **cells**, **genetics** and **ecology**.\n\nLabs run every Thursday. Bring your lab notebook.',
    academicYearId: year.id,
    termId: fall.id,
  });
  await maya.call('POST', `/courses/${bio.id}/staff`, { userProfileId: staffIds.ta, role: 'ta' });
  await maya.call('POST', `/courses/${bio.id}/students`, { studentIds });

  const labs = await maya.call('POST', `/courses/${bio.id}/assignment-groups`, { name: 'Labs', weight: 40 });
  const quizzes = await maya.call('POST', `/courses/${bio.id}/assignment-groups`, { name: 'Quizzes', weight: 30 });
  const exams = await maya.call('POST', `/courses/${bio.id}/assignment-groups`, { name: 'Exams', weight: 30 });

  const syllabus = await maya.call('POST', `/courses/${bio.id}/pages`, {
    title: 'Syllabus',
    isPublished: true,
    body: [
      '# Biology 101 syllabus',
      '',
      '| Category | Weight |',
      '|---|---|',
      '| Labs | 40% |',
      '| Quizzes | 30% |',
      '| Exams | 30% |',
      '',
      '## Expectations',
      '- Read the module page **before** each class.',
      '- Late labs lose 10% per day.',
      '',
      '> Questions? Message Ms Patel or Ms Ruiz in Messages.',
    ].join('\n'),
  });
  const safety = await maya.call('POST', `/courses/${bio.id}/pages`, {
    title: 'Lab safety rules',
    isPublished: true,
    body: '1. Goggles on at all times.\n2. No food or drink.\n3. Report every spill.\n\nSee the [school safety policy](https://example.com/safety).',
  });
  const genetics = await maya.call('POST', `/courses/${bio.id}/pages`, {
    title: 'Genetics primer',
    isPublished: true,
    body: '## Dominant and recessive alleles\n\nA capital letter (`B`) marks a dominant allele, a lower-case one (`b`) a recessive one.',
  });
  await maya.call('POST', `/courses/${bio.id}/pages`, {
    title: 'Ecology field trip (draft)',
    body: 'Details to follow.',
  });

  const cellDiagram = await maya.call('POST', `/courses/${bio.id}/activities`, {
    kind: 'assignment',
    title: 'Label a plant cell',
    instructions: 'Draw or describe a plant cell and label at least **six** organelles.',
    points: 20,
    dueAt: daysFromNow(-5),
    assignmentGroupId: labs.id,
    allowText: true,
    allowFile: true,
  });
  const punnett = await maya.call('POST', `/courses/${bio.id}/activities`, {
    kind: 'assignment',
    title: 'Punnett squares worksheet',
    instructions: 'Work through the four crosses on the genetics primer page and explain each ratio.',
    points: 30,
    dueAt: daysFromNow(4),
    assignmentGroupId: labs.id,
    allowText: true,
  });
  const microscope = await maya.call('POST', `/courses/${bio.id}/activities`, {
    kind: 'offline',
    title: 'Microscope practical',
    instructions: 'Assessed in the lab on Thursday.',
    points: 25,
    dueAt: daysFromNow(-2, 15, 0),
    assignmentGroupId: labs.id,
  });
  const cellQuiz = await maya.call('POST', `/courses/${bio.id}/activities`, {
    kind: 'quiz',
    title: 'Cell basics quiz',
    instructions: 'Three questions, two attempts.',
    points: 10,
    dueAt: daysFromNow(2),
    assignmentGroupId: quizzes.id,
    maxAttempts: 2,
  });
  const q1 = await maya.call('POST', `/activities/${cellQuiz.id}/questions`, {
    prompt: 'Which organelle carries out photosynthesis?',
    kind: 'multiple_choice',
    points: 1,
    options: [
      { label: 'Mitochondrion', isCorrect: false },
      { label: 'Chloroplast', isCorrect: true },
      { label: 'Ribosome', isCorrect: false },
    ],
  });
  const q2 = await maya.call('POST', `/activities/${cellQuiz.id}/questions`, {
    prompt: 'Animal cells have a cell wall.',
    kind: 'true_false',
    points: 1,
    options: [
      { label: 'True', isCorrect: false },
      { label: 'False', isCorrect: true },
    ],
  });
  const q3 = await maya.call('POST', `/activities/${cellQuiz.id}/questions`, {
    prompt: 'What is the control centre of the cell?',
    kind: 'short_answer',
    points: 1,
    options: [{ label: 'nucleus', isCorrect: true }, { label: 'the nucleus', isCorrect: true }],
  });
  const midterm = await maya.call('POST', `/courses/${bio.id}/activities`, {
    kind: 'offline',
    title: 'Midterm exam',
    points: 100,
    dueAt: daysFromNow(21, 9, 0),
    assignmentGroupId: exams.id,
  });

  for (const a of [cellDiagram, punnett, microscope, cellQuiz, midterm]) {
    await maya.call('POST', `/activities/${a.id}/publish`);
  }

  const week1 = await maya.call('POST', `/courses/${bio.id}/modules`, { title: 'Week 1 - Cells' });
  const week2 = await maya.call('POST', `/courses/${bio.id}/modules`, { title: 'Week 2 - Genetics' });
  const week3 = await maya.call('POST', `/courses/${bio.id}/modules`, { title: 'Week 3 - Ecology' });
  const items = (m: any) => `/courses/${bio.id}/modules/${m.id}/items`;
  await maya.call('POST', items(week1), { itemType: 'header', title: 'Start here' });
  await maya.call('POST', items(week1), { itemType: 'page', pageId: syllabus.id, indent: 1 });
  await maya.call('POST', items(week1), { itemType: 'page', pageId: safety.id, indent: 1 });
  await maya.call('POST', items(week1), { itemType: 'header', title: 'Work' });
  await maya.call('POST', items(week1), { itemType: 'activity', activityId: cellDiagram.id, indent: 1 });
  await maya.call('POST', items(week1), { itemType: 'activity', activityId: cellQuiz.id, indent: 1 });
  await maya.call('POST', items(week1), { itemType: 'activity', activityId: microscope.id, indent: 1 });
  await maya.call('POST', items(week2), { itemType: 'page', pageId: genetics.id });
  await maya.call('POST', items(week2), {
    itemType: 'link',
    title: 'Khan Academy: Punnett squares',
    url: 'https://www.khanacademy.org/science/biology/classical-genetics',
  });
  await maya.call('POST', items(week2), { itemType: 'activity', activityId: punnett.id });
  await maya.call('POST', items(week3), { itemType: 'header', title: 'Coming soon' });
  for (const m of [week1, week2]) {
    await maya.call('PATCH', `/courses/${bio.id}/modules/${m.id}`, { isPublished: true });
  }

  await maya.call('POST', `/courses/${bio.id}/announcements`, {
    title: 'Welcome to Biology 101!',
    body: 'Start with the **Syllabus** in Week 1. First lab is Thursday.',
  });
  await maya.call('POST', `/courses/${bio.id}/announcements`, {
    title: 'Quiz opens Friday',
    body: 'The cell basics quiz has two attempts. Your best effort counts, so take your time.',
  });

  await maya.call('PATCH', `/courses/${bio.id}`, { status: 'published' });
  const { joinCode: bioCode } = await maya.call('POST', `/courses/${bio.id}/join-code`);

  // ── Algebra I: unweighted, points-based ───────────────────────────────────
  const alg = await leo.call('POST', '/courses', {
    name: 'Algebra I',
    code: 'MATH-110',
    description: 'Linear equations, inequalities and functions. Grades are total points.',
    academicYearId: year.id,
    termId: fall.id,
  });
  await leo.call('POST', `/courses/${alg.id}/students`, { studentIds: studentIds.slice(0, 8) });
  const hw1 = await leo.call('POST', `/courses/${alg.id}/activities`, {
    kind: 'assignment', title: 'Homework 1: one-step equations', points: 10, dueAt: daysFromNow(-9), allowText: true,
  });
  const hw2 = await leo.call('POST', `/courses/${alg.id}/activities`, {
    kind: 'assignment', title: 'Homework 2: two-step equations', points: 10, dueAt: daysFromNow(1), allowText: true,
  });
  const algQuiz = await leo.call('POST', `/courses/${alg.id}/activities`, {
    kind: 'quiz', title: 'Equations check-in', points: 5, dueAt: daysFromNow(6),
  });
  await leo.call('POST', `/activities/${algQuiz.id}/questions`, {
    prompt: 'Solve: x + 7 = 12', kind: 'short_answer', points: 1, options: [{ label: '5', isCorrect: true }],
  });
  for (const a of [hw1, hw2, algQuiz]) await leo.call('POST', `/activities/${a.id}/publish`);
  const algMod = await leo.call('POST', `/courses/${alg.id}/modules`, { title: 'Unit 1 - Equations' });
  for (const a of [hw1, hw2, algQuiz]) {
    await leo.call('POST', `/courses/${alg.id}/modules/${algMod.id}/items`, { itemType: 'activity', activityId: a.id });
  }
  await leo.call('PATCH', `/courses/${alg.id}/modules/${algMod.id}`, { isPublished: true });
  await leo.call('PATCH', `/courses/${alg.id}`, { status: 'published' });

  // ── World History: still a draft ──────────────────────────────────────────
  const hist = await maya.call('POST', '/courses', {
    name: 'World History',
    code: 'HIST-201',
    description: 'Being built for Spring.',
    academicYearId: year.id,
  });
  await maya.call('POST', `/courses/${hist.id}/pages`, { title: 'Course outline', body: 'TBD' });

  // ── Creative Writing: last year's, archived ───────────────────────────────
  const cw = await leo.call('POST', '/courses', { name: 'Creative Writing', code: 'ENG-150' });
  await leo.call('POST', `/courses/${cw.id}/students`, { studentIds: [jordan, priya, marcus] });
  const story = await leo.call('POST', `/courses/${cw.id}/activities`, {
    kind: 'offline', title: 'Short story portfolio', points: 50,
  });
  await leo.call('POST', `/activities/${story.id}/publish`);
  for (const [id, score] of [[jordan, 44], [priya, 47], [marcus, 38]] as const) {
    await leo.call('PATCH', `/activities/${story.id}/submissions/${id}/grade`, { score, feedback: 'Strong voice.' });
  }
  await leo.call('PATCH', `/courses/${cw.id}`, { status: 'archived' });

  // ── student work ──────────────────────────────────────────────────────────
  console.log('Handing in student work...');
  const jordanS = await new Session(`student@${DOMAIN}`).login();
  const priyaS = await new Session(`student2@${DOMAIN}`).login();

  await jordanS.call('POST', `/portal/me/activities/${cellDiagram.id}/submit`, {
    textBody: 'Cell wall, cell membrane, nucleus, chloroplast, vacuole, mitochondrion, ribosome.',
  });
  await priyaS.call('POST', `/portal/me/activities/${cellDiagram.id}/submit`, {
    textBody: 'Nucleus, chloroplast, vacuole, cell wall, membrane, cytoplasm.',
  });
  await priyaS.call('POST', `/portal/me/activities/${hw1.id}/submit`, { textBody: 'x=3, x=-2, x=11' });

  // Jordan sits the quiz: two right, one wrong (scored automatically).
  const quiz = await jordanS.call('GET', `/portal/me/activities/${cellQuiz.id}`);
  const opt = (qid: string, label: string) =>
    quiz.questions.find((q: any) => q.id === qid).options.find((o: any) => o.label === label).id;
  await jordanS.call('POST', `/portal/me/activities/${cellQuiz.id}/quiz`, {
    answers: [
      { questionId: q1.id, optionId: opt(q1.id, 'Chloroplast') },
      { questionId: q2.id, optionId: opt(q2.id, 'True') },
      { questionId: q3.id, text: 'Nucleus' },
    ],
  });

  // Marking: Jordan's lab is marked, Priya's waits in the queue; the practical
  // is recorded for most of the class, with one student excused.
  await maya.call('PATCH', `/activities/${cellDiagram.id}/submissions/${jordan}/grade`, {
    score: 18,
    feedback: 'Great detail. Add the Golgi apparatus next time.',
  });
  const practical = [17, 22, 20, 25, 14, 19, 23, 21, 16, 24];
  for (let i = 0; i < practical.length; i++) {
    await maya.call('PATCH', `/activities/${microscope.id}/submissions/${studentIds[i]}/grade`, { score: practical[i] });
  }
  await maya.call('PATCH', `/activities/${microscope.id}/submissions/${studentIds[11]}/excuse`, {
    excused: true,
    reason: 'Medical note',
  });
  for (const [i, score] of [[0, 9], [2, 7], [3, 10], [4, 6], [5, 8]] as const) {
    await leo.call('PATCH', `/activities/${hw1.id}/submissions/${studentIds[i]}/grade`, { score });
  }

  // Three past Biology classes of attendance. Written directly rather than
  // through the API, which can only open a session now.
  const pattern: ('present' | 'late' | 'absent' | 'excused')[][] = [
    ['present', 'present', 'late', 'present', 'absent', 'present', 'present', 'present', 'late', 'present', 'present', 'excused'],
    ['present', 'present', 'present', 'absent', 'absent', 'present', 'late', 'present', 'present', 'present', 'absent', 'present'],
    ['present', 'late', 'present', 'present', 'present', 'present', 'present', 'absent', 'present', 'present', 'present', 'present'],
  ];
  for (let day = 0; day < pattern.length; day++) {
    const opened = new Date();
    opened.setDate(opened.getDate() - 7 * (pattern.length - day));
    opened.setHours(9, 0, 0, 0);
    const closes = new Date(opened.getTime() + 5 * 60_000);
    const session = must(
      await db
        .schema('course')
        .from('attendance_session')
        .insert({
          course_id: bio.id,
          opened_by: staffIds.teacher,
          opened_at: opened.toISOString(),
          closes_at: closes.toISOString(),
          closed_at: closes.toISOString(),
          check_in_code: String(1000 + day * 1111),
          late_after_minutes: 2,
        })
        .select('id')
        .single(),
      'attendance session',
    );
    must(
      await db
        .schema('course')
        .from('attendance_record')
        .insert(
          pattern[day].map((status, i) => ({
            session_id: session.id,
            course_id: bio.id,
            student_id: studentIds[i],
            status,
            method: status === 'absent' ? 'auto' : status === 'excused' ? 'teacher' : 'self',
            checked_in_at:
              status === 'present' || status === 'late'
                ? new Date(opened.getTime() + (status === 'late' ? 180_000 : 45_000)).toISOString()
                : null,
            note: status === 'excused' ? 'Doctor appointment' : null,
          })),
        )
        .select('id'),
      'attendance records',
    );
  }

  await admin.call('POST', '/announcements', {
    title: 'Welcome to the new Riverside course site',
    body: 'Classes now live in **Courses**. Teachers: build your modules; students: check your to-do list.',
  });

  console.log(`
Demo ready - ${SCHOOL_NAME}

Staff (web: http://localhost:3000/login)
  admin@${DOMAIN}     Grace Okafor   school admin, sees every course
  teacher@${DOMAIN}   Maya Patel     teaches Biology 101, World History (draft)
  teacher2@${DOMAIN}  Leo Brooks     teaches Algebra I, Creative Writing (archived)
  ta@${DOMAIN}        Ana Ruiz       TA in Biology 101

Students
  student@${DOMAIN}   Jordan Lee     Biology, Algebra, Creative Writing; quiz taken, lab marked
  student2@${DOMAIN}  Priya Shah     lab handed in, waiting to be marked
  student3@${DOMAIN}  Marcus Bell
  + 9 roster-only students

Biology 101 join code: ${bioCode}

Log in without email (local mail is capped at 2/hour):
  bun run seed:demo otp teacher@${DOMAIN}
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'otp') {
    if (!args[1]) throw new Error('Usage: bun run seed:demo otp <email>');
    console.log(await mintOtp(args[1]));
    return;
  }
  if (args.includes('--fresh')) await wipe();
  await seed();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
