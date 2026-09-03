/// <reference path="../deno.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AttendanceStatus = "present" | "absent" | "late";
type AttendanceCounts = {
  present: number;
  absent: number;
  late: number;
  total: number;
};
type Student = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};
type Enrollment = { student: Student | Student[] | null };
type AttendanceRow = { student_id: string; status: AttendanceStatus };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const emptyCounts = (): AttendanceCounts => ({
  present: 0,
  absent: 0,
  late: 0,
  total: 0,
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
  const { classId, from, to } = body ?? {};
  if (
    typeof classId !== "string" ||
    typeof from !== "string" ||
    typeof to !== "string" ||
    from > to
  ) {
    return json({ error: "classId, from, and to are required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );

  const [
    { data: enrollments, error: enrollmentError },
    { data: records, error: recordError },
  ] = await Promise.all([
    supabase
      .schema("student")
      .from("student_group_enrollment")
      .select("student:student_id(id, first_name, last_name)")
      .eq("student_group_id", classId),
    supabase
      .schema("student")
      .from("attendance_record")
      .select("student_id, status")
      .eq("student_group_id", classId)
      .gte("attendance_date", from)
      .lte("attendance_date", to),
  ]);

  if (enrollmentError || recordError) {
    return json(
      { error: enrollmentError?.message ?? recordError?.message },
      400,
    );
  }

  const students = ((enrollments ?? []) as Enrollment[])
    .map((enrollment) =>
      Array.isArray(enrollment.student)
        ? enrollment.student[0]
        : enrollment.student,
    )
    .filter((student): student is Student => Boolean(student));
  const countsByStudent = new Map<string, AttendanceCounts>();
  for (const student of students)
    countsByStudent.set(student.id, emptyCounts());

  for (const record of (records ?? []) as AttendanceRow[]) {
    const counts = countsByStudent.get(record.student_id);
    if (!counts) continue;
    counts[record.status] += 1;
    counts.total += 1;
  }

  const summaries = students.map((student) => {
    const counts = countsByStudent.get(student.id) ?? emptyCounts();
    const attended = counts.present + counts.late;
    return {
      studentId: student.id,
      firstName: student.first_name ?? "",
      lastName: student.last_name ?? "",
      counts,
      presentPercentage: counts.total
        ? Math.round((attended / counts.total) * 1000) / 10
        : 0,
    };
  });
  const classCounts = summaries.reduce<AttendanceCounts>((total, summary) => {
    total.present += summary.counts.present;
    total.absent += summary.counts.absent;
    total.late += summary.counts.late;
    total.total += summary.counts.total;
    return total;
  }, emptyCounts());

  return json({
    classId,
    from,
    to,
    counts: classCounts,
    studentCount: summaries.length,
    presentPercentage: classCounts.total
      ? Math.round(
          ((classCounts.present + classCounts.late) / classCounts.total) * 1000,
        ) / 10
      : 0,
    students: summaries,
  });
});
