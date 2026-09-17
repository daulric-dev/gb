/**
 * RLS check against a local Supabase.
 *
 *   bun run scripts/rls-check.ts
 *
 * The API talks to Postgres through the service client, which bypasses RLS,
 * so nothing here exercises application code. It exercises the layer that has
 * to hold if a user ever reaches PostgREST directly with their own JWT.
 *
 * Unit tests cannot cover this: they mock Supabase, so policies never run.
 * Run it against a local database after touching policies, triggers, or
 * anything that decides what a role may see.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  process.env.SUPABASE_PUSHABLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

if (!URL.includes('127.0.0.1') && !URL.includes('localhost')) {
  console.error('Refusing to run: this script writes fixtures. Point it at a local Supabase.');
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const results: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const stamp = Date.now();
const PASSWORD = 'Password123!';

async function makeUser(tag: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `rlscheck-${tag}-${stamp}@t.test`,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

async function signIn(tag: string): Promise<SupabaseClient> {
  const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: `rlscheck-${tag}-${stamp}@t.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

async function main() {
  const adminId = await makeUser('admin');
  const teacherId = await makeUser('teacher');
  const studentId = await makeUser('student');

  const { data: school } = await admin
    .from('school')
    .insert({ name: `RLS check ${stamp}` })
    .select('id')
    .single();
  const schoolId = school!.id;

  await admin.from('user_profile').upsert([
    { id: adminId, first_name: 'Ada', school_id: schoolId, role: 'admin', account_type: 'staff' },
    { id: teacherId, first_name: 'Tom', school_id: schoolId, role: 'teacher', account_type: 'staff' },
    { id: studentId, first_name: 'Sam', school_id: schoolId, account_type: 'student' },
  ]);

  const { data: ownRecord } = await admin
    .schema('student')
    .from('student')
    .insert({
      school_id: schoolId,
      first_name: 'Sam',
      last_name: 'Self',
      user_profile_id: studentId,
    })
    .select('id')
    .single();

  const { data: classmate } = await admin
    .schema('student')
    .from('student')
    .insert({ school_id: schoolId, first_name: 'Class', last_name: 'Mate' })
    .select('id')
    .single();

  await admin.schema('student').from('student_claim_code').insert({
    school_id: schoolId,
    student_id: classmate!.id,
    code_hash: `check-${stamp}`,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_by: adminId,
  });

  // ── a student sees their own record and nothing else ─────────────────────
  const asStudent = await signIn('student');

  const roster = await asStudent.schema('student').from('student').select('id');
  check(
    'student reads only their own record',
    !roster.error && roster.data.length === 1 && roster.data[0].id === ownRecord!.id,
    roster.error?.message ?? `${roster.data?.length} row(s)`,
  );

  const edit = await asStudent
    .schema('student')
    .from('student')
    .update({ last_name: 'Tampered' })
    .eq('id', classmate!.id)
    .select('id');
  check(
    'student cannot edit a classmate',
    !!edit.error || edit.data.length === 0,
    edit.error?.code ?? `${edit.data?.length} row(s)`,
  );

  const remove = await asStudent
    .schema('student')
    .from('student')
    .delete()
    .eq('id', classmate!.id)
    .select('id');
  check(
    'student cannot delete a classmate',
    !!remove.error || remove.data.length === 0,
    remove.error?.code ?? `${remove.data?.length} row(s)`,
  );

  const relink = await asStudent
    .schema('student')
    .from('student')
    .update({ user_profile_id: teacherId })
    .eq('id', ownRecord!.id)
    .select('id');
  check(
    'student cannot re-point their record at another login',
    !!relink.error || relink.data.length === 0,
    relink.error?.code ?? `${relink.data?.length} row(s)`,
  );

  const codes = await asStudent
    .schema('student')
    .from('student_claim_code')
    .select('code_hash');
  check(
    'student cannot read claim codes',
    !!codes.error || codes.data.length === 0,
    codes.error?.code ?? `${codes.data?.length} row(s)`,
  );

  const promote = await asStudent
    .from('user_profile')
    .update({ role: 'admin', account_type: 'staff' })
    .eq('id', studentId)
    .select('role');
  check(
    'student cannot promote themselves',
    !!promote.error,
    promote.error?.code ?? JSON.stringify(promote.data),
  );

  // ── staff keep the access the app relies on ──────────────────────────────
  const asAdmin = await signIn('admin');

  const staffRoster = await asAdmin.schema('student').from('student').select('id');
  check(
    'staff read the whole roster',
    !staffRoster.error && staffRoster.data.length === 2,
    staffRoster.error?.message ?? `${staffRoster.data?.length} row(s)`,
  );

  const staffEdit = await asAdmin
    .schema('student')
    .from('student')
    .update({ last_name: 'Edited' })
    .eq('id', classmate!.id)
    .select('id');
  check(
    'staff edit a student record',
    !staffEdit.error && staffEdit.data.length === 1,
    staffEdit.error?.message ?? `${staffEdit.data?.length} row(s)`,
  );

  const staffProfiles = await asAdmin.from('user_profile').select('id');
  check(
    'staff read school profiles',
    !staffProfiles.error && staffProfiles.data.length >= 3,
    staffProfiles.error?.message ?? `${staffProfiles.data?.length} row(s)`,
  );

  const asTeacher = await signIn('teacher');
  const teacherPromote = await asTeacher
    .from('user_profile')
    .update({ role: 'admin' })
    .eq('id', teacherId)
    .select('role');
  check(
    'a teacher cannot promote themselves',
    !!teacherPromote.error,
    teacherPromote.error?.code ?? JSON.stringify(teacherPromote.data),
  );

  const rename = await asTeacher
    .from('user_profile')
    .update({ first_name: 'Thomas' })
    .eq('id', teacherId)
    .select('first_name');
  check(
    'a user can still edit their own name',
    !rename.error && rename.data[0].first_name === 'Thomas',
    rename.error?.message ?? 'ok',
  );

  // ── the service role is unaffected ───────────────────────────────────────
  const svcRole = await admin
    .from('user_profile')
    .update({ role: 'member' })
    .eq('id', teacherId)
    .select('role');
  check(
    'service role still changes roles',
    !svcRole.error && svcRole.data[0].role === 'member',
    svcRole.error?.message ?? 'ok',
  );

  const svcLink = await admin
    .schema('student')
    .from('student')
    .update({ user_profile_id: null })
    .eq('id', ownRecord!.id)
    .select('id');
  check(
    'service role still manages the account link',
    !svcLink.error,
    svcLink.error?.message ?? 'ok',
  );

  console.log('\n' + results.join('\n') + '\n');
  if (process.exitCode) console.error('RLS check FAILED\n');
}

main().catch((err) => {
  console.error('RLS check errored:', err);
  process.exit(1);
});
