/// <reference path="../deno.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Profile = { school_id: string | null };
type AcademicYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  grading_model: string;
};
type Group = { id: string };
type Student = {
  id: string;
  gender: "male" | "female" | null;
  is_active: boolean;
};
type Membership = { id: string; role: "admin" | "teacher" | "member" };
type Attendance = { status: "present" | "absent" | "late" };

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  if (typeof body?.userId !== "string")
    return json({ error: "userId is required" }, 400);

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );

  const { data: profile, error: profileError } = await client
    .from("user_profile")
    .select("school_id")
    .eq("id", body.userId)
    .single();
  if (profileError || !(profile as Profile | null)?.school_id) {
    return json({ error: "School profile not found" }, 404);
  }
  const schoolId = (profile as Profile).school_id as string;

  const { data: years } = await client
    .from("academic_year")
    .select("id, name, start_date, end_date, grading_model")
    .eq("school_id", schoolId)
    .order("start_date", { ascending: false });
  const activeYear =
    (years ?? []).find(
      (year: AcademicYear) =>
        year.start_date <= new Date().toISOString().slice(0, 10) &&
        year.end_date >= new Date().toISOString().slice(0, 10),
    ) ??
    (years?.[0] as AcademicYear | undefined) ??
    null;
  const yearIds = (years ?? []).map((year: AcademicYear) => year.id);

  const [{ data: groups }, { data: memberships }] = await Promise.all([
    yearIds.length
      ? client
          .from("student_group")
          .select("id")
          .in("academic_year_id", yearIds)
      : Promise.resolve({ data: [] as Group[] }),
    client
      .from("school_management")
      .select("id, role")
      .eq("school_id", schoolId),
  ]);
  const groupIds = (groups ?? []).map((group: Group) => group.id);

  const [{ data: students }, { data: attendance }] = await Promise.all([
    groupIds.length
      ? client
          .schema("student")
          .from("student_group_enrollment")
          .select("student:student_id(id, gender, is_active)")
          .in("student_group_id", groupIds)
      : Promise.resolve({ data: [] as Array<{ student: Student | null }> }),
    groupIds.length
      ? client
          .schema("student")
          .from("attendance_record")
          .select("status")
          .in("student_group_id", groupIds)
      : Promise.resolve({ data: [] as Attendance[] }),
  ]);

  const uniqueStudents = new Map<string, Student>();
  for (const enrollment of (students ?? []) as Array<{
    student: Student | Student[] | null;
  }>) {
    const student = Array.isArray(enrollment.student)
      ? enrollment.student[0]
      : enrollment.student;
    if (student) uniqueStudents.set(student.id, student);
  }
  const attendanceCounts = { present: 0, absent: 0, late: 0, total: 0 };
  for (const row of (attendance ?? []) as Attendance[]) {
    attendanceCounts[row.status] += 1;
    attendanceCounts.total += 1;
  }

  return json({
    schoolId,
    activeYear,
    classes: groupIds.length,
    students: {
      total: uniqueStudents.size,
      active: [...uniqueStudents.values()].filter(
        (student) => student.is_active,
      ).length,
      male: [...uniqueStudents.values()].filter(
        (student) => student.is_active && student.gender === "male",
      ).length,
      female: [...uniqueStudents.values()].filter(
        (student) => student.is_active && student.gender === "female",
      ).length,
    },
    staff: {
      total: (memberships ?? []).length,
      admins: (memberships ?? []).filter(
        (member: Membership) => member.role === "admin",
      ).length,
      teachers: (memberships ?? []).filter(
        (member: Membership) => member.role === "teacher",
      ).length,
      members: (memberships ?? []).filter(
        (member: Membership) => member.role === "member",
      ).length,
    },
    attendance: attendanceCounts,
  });
});
