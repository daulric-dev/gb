import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ReportDetail } from "./reports";
import { defaultPdfStoragePath } from "./reports";
import { getSupabaseBrowserClient } from "./supabase-browser";

const BUCKET = "report-cards";

export function buildReportPdfBlob(r: ReportDetail): Blob {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const st = r.student;
  const name = st ? `${st.first_name} ${st.last_name}`.trim() : "Student";

  doc.setFontSize(16);
  doc.text("Report card", 14, 18);
  doc.setFontSize(10);
  let y = 28;
  doc.text(`Student: ${name}`, 14, y);
  y += 6;
  doc.text(`Report type: ${r.report_type ?? "—"}`, 14, y);
  y += 6;
  doc.text(`Status: ${r.status ?? "—"}`, 14, y);
  y += 6;
  if (r.overall_average != null) {
    doc.text(`Overall average: ${r.overall_average.toFixed(2)}`, 14, y);
    y += 6;
  }
  if (r.position != null && r.total_students != null) {
    doc.text(`Position: ${r.position} of ${r.total_students}`, 14, y);
    y += 6;
  }
  if (r.conduct) {
    doc.text(`Conduct: ${r.conduct}`, 14, y);
    y += 6;
  }
  if (r.attendance_percentage != null) {
    doc.text(`Attendance: ${r.attendance_percentage}%`, 14, y);
    y += 6;
  }
  if (r.class_teacher_remark) {
    const lines = doc.splitTextToSize(
      `Class teacher remark: ${r.class_teacher_remark}`,
      180,
    );
    doc.text(lines, 14, y);
    y += lines.length * 5 + 4;
  }

  autoTable(doc, {
    startY: y + 4,
    head: [
      ["Subject", "Course", "Exam", "Term", "Year", "Grade", "Remark"],
    ],
    body: r.entries.map((e) => [
      e.subject?.name ?? "—",
      e.coursework_average != null ? e.coursework_average.toFixed(1) : "—",
      e.exam_average != null ? e.exam_average.toFixed(1) : "—",
      e.term_composite != null ? e.term_composite.toFixed(1) : "—",
      e.year_grade != null ? e.year_grade.toFixed(1) : "—",
      e.letter_grade ?? "—",
      (e.teacher_remark ?? "").slice(0, 120),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [66, 66, 66] },
  });

  return doc.output("blob");
}

/** Upload PDF bytes to Storage; returns path inside bucket and byte size. */
export async function uploadReportPdfToStorage(
  objectPath: string,
  blob: Blob,
): Promise<{ path: string; size: number }> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, blob, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) {
    throw new Error(error.message);
  }
  return { path: objectPath, size: blob.size };
}

export function objectPathForReport(r: ReportDetail): string {
  return defaultPdfStoragePath(r);
}
