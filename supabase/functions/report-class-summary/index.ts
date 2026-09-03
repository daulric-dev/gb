/// <reference path="../deno.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ReportEntry = {
  report_book_id: string;
  subject_id: string;
  coursework_average: number | null;
  exam_average: number | null;
  term_composite: number | null;
  year_grade: number | null;
  sort_order: number | null;
};

type ReportBook = {
  id: string;
  student_id: string | null;
  overall_average: number | null;
  position: number | null;
  total_students: number | null;
};

type StudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type SubjectRow = { id: string; name: string | null };

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
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  const studentGroupId = body?.studentGroupId;
  const termId = body?.termId;
  const reportType = body?.reportType || null;
  if (typeof studentGroupId !== "string" || typeof termId !== "string") {
    return json({ error: "studentGroupId and termId are required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );

  const reporting = supabase.schema("reporting");
  let reportsQuery = reporting
    .from("report_book")
    .select("id, student_id, overall_average, position, total_students")
    .eq("student_group_id", studentGroupId)
    .eq("term_id", termId);
  if (reportType) reportsQuery = reportsQuery.eq("report_type", reportType);

  const [
    { data: reports, error: reportsError },
    { data: term, error: termError },
  ] = await Promise.all([
    reportsQuery.order("position", { ascending: true }),
    supabase
      .from("term")
      .select("coursework_weight, exam_weight, academic_year_id")
      .eq("id", termId)
      .single(),
  ]);

  if (reportsError || termError) {
    return json({ error: reportsError?.message ?? termError?.message }, 400);
  }

  const list = (reports ?? []) as ReportBook[];
  if (list.length === 0) {
    return json({
      classAverage: null,
      highestAverage: null,
      lowestAverage: null,
      totalStudents: 0,
      passCount: 0,
      failCount: 0,
      courseworkWeight: 50,
      examWeight: 50,
      gradingModel: "weighted_continuous",
      subjectAverages: [],
      students: [],
    });
  }

  const { data: academicYear } = await supabase
    .from("academic_year")
    .select("grading_model, year_coursework_weight, year_exam_weight")
    .eq("id", term.academic_year_id)
    .maybeSingle();

  const gradingModel = academicYear?.grading_model ?? "weighted_continuous";
  const isYearEnd =
    reportType === "year_end" && gradingModel !== "weighted_continuous";
  const courseworkWeight = isYearEnd
    ? (academicYear?.year_coursework_weight ?? 50)
    : (term.coursework_weight ?? 50);
  const examWeight = isYearEnd
    ? (academicYear?.year_exam_weight ?? 50)
    : (term.exam_weight ?? 50);

  const reportIds = list.map((report: { id: string }) => report.id);
  const { data: entries, error: entriesError } = await reporting
    .from("report_book_entry")
    .select(
      "report_book_id, subject_id, coursework_average, exam_average, term_composite, year_grade, sort_order",
    )
    .in("report_book_id", reportIds)
    .order("sort_order", { ascending: true });
  if (entriesError) return json({ error: entriesError.message }, 400);

  const entryRows = (entries ?? []) as ReportEntry[];
  const studentIds = list
    .map((report: ReportBook) => report.student_id)
    .filter((id): id is string => Boolean(id));
  const subjectIds = [
    ...new Set(
      entryRows
        .map((entry: { subject_id: string }) => entry.subject_id)
        .filter(Boolean) as string[],
    ),
  ];
  const [{ data: students }, { data: subjects }] = await Promise.all([
    supabase
      .schema("student")
      .from("student")
      .select("id, first_name, last_name")
      .in("id", studentIds),
    supabase.from("subject").select("id, name").in("id", subjectIds),
  ]);

  const studentMap = new Map<string, StudentRow>(
    ((students ?? []) as StudentRow[]).map((student: StudentRow) => [
      student.id,
      student,
    ]),
  );
  const subjectMap = new Map<string, SubjectRow>(
    ((subjects ?? []) as SubjectRow[]).map((subject: SubjectRow) => [
      subject.id,
      subject,
    ]),
  );
  const entriesByReport = new Map<string, ReportEntry[]>();
  for (const entry of entryRows) {
    const reportEntries = entriesByReport.get(entry.report_book_id) ?? [];
    reportEntries.push(entry);
    entriesByReport.set(entry.report_book_id, reportEntries);
  }

  const averages = list
    .map((report: ReportBook) => report.overall_average)
    .filter((value: number | null): value is number => value != null);
  const subjectScores = new Map<string, number[]>();
  for (const entry of entryRows) {
    const score = isYearEnd ? entry.year_grade : entry.term_composite;
    if (score == null) continue;
    subjectScores.set(entry.subject_id, [
      ...(subjectScores.get(entry.subject_id) ?? []),
      score,
    ]);
  }

  return json({
    classAverage: averages.length
      ? Math.round(
          (averages.reduce((sum: number, value: number) => sum + value, 0) /
            averages.length) *
            100,
        ) / 100
      : null,
    highestAverage: averages.length ? Math.max(...averages) : null,
    lowestAverage: averages.length ? Math.min(...averages) : null,
    totalStudents: list.length,
    passCount: averages.filter((value: number) => value >= 50).length,
    failCount: averages.filter((value: number) => value < 50).length,
    courseworkWeight,
    examWeight,
    gradingModel,
    subjectAverages: [...subjectScores.entries()].map(
      ([subjectId, scores]) => ({
        subjectId,
        subjectName: subjectMap.get(subjectId)?.name ?? "Unknown",
        average:
          scores.reduce((sum: number, value: number) => sum + value, 0) /
          scores.length,
        highestMark: Math.max(...scores),
        lowestMark: Math.min(...scores),
      }),
    ),
    students: list.map((report: ReportBook) => {
      const student = report.student_id
        ? studentMap.get(report.student_id)
        : undefined;
      return {
        studentId: report.student_id,
        firstName: student?.first_name ?? "",
        lastName: student?.last_name ?? "",
        overallAverage: report.overall_average,
        position: report.position,
        subjects: (entriesByReport.get(report.id) ?? []).map((entry) => ({
          subjectId: entry.subject_id,
          subjectName: subjectMap.get(entry.subject_id)?.name ?? "Unknown",
          courseworkAverage: entry.coursework_average,
          examAverage: entry.exam_average,
          termComposite: entry.term_composite,
          yearGrade: entry.year_grade,
        })),
      };
    }),
  });
});
