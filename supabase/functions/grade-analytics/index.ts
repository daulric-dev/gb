/// <reference path="../deno.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Report = { overall_average: number | null };
type Entry = {
  subject_id: string;
  term_composite: number | null;
  year_grade: number | null;
};
type Subject = { id: string; name: string | null };

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
  const { studentGroupId, termId, reportType } = body ?? {};
  if (typeof studentGroupId !== "string" || typeof termId !== "string") {
    return json({ error: "studentGroupId and termId are required" }, 400);
  }

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );
  const reporting = client.schema("reporting");
  let reportQuery = reporting
    .from("report_book")
    .select("id, overall_average")
    .eq("student_group_id", studentGroupId)
    .eq("term_id", termId);
  if (reportType) reportQuery = reportQuery.eq("report_type", reportType);

  const { data: reports, error: reportError } = await reportQuery;
  if (reportError) return json({ error: reportError.message }, 400);
  const reportRows = (reports ?? []) as Array<Report & { id: string }>;
  if (reportRows.length === 0) {
    return json({
      studentCount: 0,
      passCount: 0,
      failCount: 0,
      passRate: 0,
      distribution: [],
      subjects: [],
    });
  }

  const { data: entries, error: entryError } = await reporting
    .from("report_book_entry")
    .select("subject_id, term_composite, year_grade")
    .in(
      "report_book_id",
      reportRows.map((report) => report.id),
    );
  if (entryError) return json({ error: entryError.message }, 400);

  const isYearEnd = reportType === "year_end";
  const scores = reportRows
    .map((report) => report.overall_average)
    .filter((score): score is number => score != null);
  const passCount = scores.filter((score) => score >= 50).length;
  const subjectScores = new Map<string, number[]>();
  for (const entry of (entries ?? []) as Entry[]) {
    const score = isYearEnd ? entry.year_grade : entry.term_composite;
    if (score == null) continue;
    subjectScores.set(entry.subject_id, [
      ...(subjectScores.get(entry.subject_id) ?? []),
      score,
    ]);
  }

  const { data: subjects } = await client
    .from("subject")
    .select("id, name")
    .in("id", [...subjectScores.keys()]);
  const subjectMap = new Map<string, Subject>(
    ((subjects ?? []) as Subject[]).map((subject) => [subject.id, subject]),
  );
  const distribution = [
    { range: "0-49", min: 0, max: 49, count: 0 },
    { range: "50-59", min: 50, max: 59, count: 0 },
    { range: "60-69", min: 60, max: 69, count: 0 },
    { range: "70-79", min: 70, max: 79, count: 0 },
    { range: "80-100", min: 80, max: 100, count: 0 },
  ];
  for (const score of scores) {
    const bucket = distribution.find(
      (item) => score >= item.min && score <= item.max,
    );
    if (bucket) bucket.count += 1;
  }

  return json({
    studentCount: reportRows.length,
    scoredStudentCount: scores.length,
    passCount,
    failCount: scores.filter((score) => score < 50).length,
    passRate: scores.length
      ? Math.round((passCount / scores.length) * 1000) / 10
      : 0,
    classAverage: scores.length
      ? Math.round(
          (scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100,
        ) / 100
      : null,
    distribution: distribution.map(({ range, count }) => ({ range, count })),
    subjects: [...subjectScores.entries()].map(([subjectId, values]) => ({
      subjectId,
      subjectName: subjectMap.get(subjectId)?.name ?? "Unknown",
      average:
        Math.round(
          (values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
        ) / 100,
      highest: Math.max(...values),
      lowest: Math.min(...values),
      studentCount: values.length,
    })),
  });
});
