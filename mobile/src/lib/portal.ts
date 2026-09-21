/** Shapes returned by the /portal/me endpoints. Mirrors the web portal types. */

export interface PortalClass {
  id: string;
  name: string | null;
  academicYear: { id: string; name: string | null; isActive: boolean } | null;
  enrolledAt: string | null;
}

export interface PortalMe {
  id: string;
  firstName: string | null;
  lastName: string | null;
  school: { id: string; name: string | null; type: string | null } | null;
  classes: PortalClass[];
}

export interface PortalAssessment {
  id: string;
  title: string | null;
  type: string | null;
  date: string | null;
  maxScore: number | null;
  weight: number | null;
  term: { id: string; name: string | null } | null;
  score: number | null;
  letterGrade: string | null;
  remarks: string | null;
}

export interface PortalSubjectGrades {
  subject: { id: string; name: string | null; code: string | null } | null;
  assessments: PortalAssessment[];
  /** Mean of scored assessments as a percentage, or null if nothing is scored. */
  average: number | null;
}

export interface PortalAttendance {
  summary: { present: number; absent: number; late: number; total: number };
  records: { id: string; date: string; status: string }[];
}

export interface PortalReportSummary {
  id: string;
  type: string | null;
  status: string | null;
  publishedAt: string | null;
  overallAverage: number | null;
  position: number | null;
  totalStudents: number | null;
  conductGrade: string | null;
  term: { id: string; name: string | null } | null;
  academicYear: { id: string; name: string | null } | null;
}

export interface PortalReportEntry {
  id: string;
  subject: { id: string; name: string | null; code: string | null } | null;
  isGraded: boolean;
  termAverage: number | null;
  termGrade: number | null;
  termComposite: number | null;
  yearGrade: number | null;
  examAverage: number | null;
  courseworkAverage: number | null;
  letterGrade: string | null;
  teacherRemark: string | null;
}

export interface PortalReport extends PortalReportSummary {
  attendanceDays: number | null;
  totalSchoolDays: number | null;
  generalRemarks: string | null;
  entries: PortalReportEntry[];
}

const TERM_LABELS: Record<string, string> = {
  michaelmas: "Michaelmas",
  hilary: "Hilary",
  trinity: "Trinity",
};

export function termLabel(name: string | null | undefined) {
  if (!name) return "Term";
  return TERM_LABELS[name] ?? name;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Attendance rate counts late as attended, matching the web portal. */
export function attendanceRate(summary: PortalAttendance["summary"] | null) {
  if (!summary || summary.total === 0) return null;
  return Math.round(((summary.present + summary.late) / summary.total) * 100);
}
