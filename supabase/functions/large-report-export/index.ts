/// <reference path="../deno.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const csv = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => null);
  const { studentGroupId, termId, reportType } = body ?? {};
  if (typeof studentGroupId !== "string" || typeof termId !== "string") {
    return Response.json(
      { error: "studentGroupId and termId are required" },
      { status: 400 },
    );
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
  let query = reporting
    .from("report_book")
    .select("id, student_id, position, overall_average")
    .eq("student_group_id", studentGroupId)
    .eq("term_id", termId);
  if (reportType) query = query.eq("report_type", reportType);
  const { data: reports, error } = await query.order("position", {
    ascending: true,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });

  const reportRows = reports ?? [];
  const ids = reportRows.map((report) => report.id);
  const { data: entries, error: entryError } = ids.length
    ? await reporting
        .from("report_book_entry")
        .select("report_book_id, subject_id, term_composite, year_grade")
        .in("report_book_id", ids)
    : { data: [], error: null };
  if (entryError)
    return Response.json({ error: entryError.message }, { status: 400 });

  const lines = ["Position,Student ID,Subject ID,Score,Overall Average"];
  const entriesByReport = new Map<string, typeof entries>();
  for (const entry of entries ?? []) {
    const rows = entriesByReport.get(entry.report_book_id) ?? [];
    rows.push(entry);
    entriesByReport.set(entry.report_book_id, rows);
  }
  for (const report of reportRows) {
    const rows = entriesByReport.get(report.id) ?? [null];
    for (const entry of rows) {
      const score =
        reportType === "year_end" ? entry?.year_grade : entry?.term_composite;
      lines.push(
        [
          report.position,
          report.student_id,
          entry?.subject_id,
          score,
          report.overall_average,
        ]
          .map(csv)
          .join(","),
      );
    }
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="report-${studentGroupId}-${termId}.csv"`,
    },
  });
});
