/**
 * Analytics wire types (src/analytics on the API) and the text that goes
 * with each chart: every chart has a written summary and a table, so nothing
 * depends on seeing the chart or telling colours apart.
 */

export interface AtRiskRules {
  minGrade: number | null;
  missingCount: number | null;
  windowWeeks: number;
  minAttendance: number | null;
  masteryBelowLevel: number | null;
}

export interface SubmissionRates {
  onTime: number;
  late: number;
  missing: number;
  excused: number;
  pending: number;
  handedIn: number;
  rate: number | null;
  onTimeRate: number | null;
}

export interface Bin {
  from: number;
  to: number;
  count: number;
}

export interface Distribution {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  histogram: Bin[];
}

export interface RiskReason {
  rule: "grade" | "missing" | "attendance" | "mastery";
  text: string;
}

export interface AtRiskStudent {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  grade: number | null;
  missingRecent: number;
  attendanceRate: number | null;
  masteryScore: number | null;
  reasons: RiskReason[];
}

export interface ActivityAnalytics extends SubmissionRates {
  id: string;
  title: string;
  kind: "quiz" | "assignment" | "offline";
  points: number;
  dueAt: string | null;
  group: string | null;
  distribution: Distribution;
}

export interface TrendPoint {
  week: string;
  average: number;
  count: number;
}

export interface CourseAnalytics {
  course: { id: string; name: string; code: string | null };
  generatedAt: string;
  timeZone: string;
  rules: AtRiskRules;
  features: { attendance: boolean; mastery: boolean };
  students: number;
  overview: {
    averageGrade: number | null;
    medianGrade: number | null;
    submission: SubmissionRates;
    attendanceRate: number | null;
    atRisk: number;
  };
  activities: ActivityAnalytics[];
  gradeDistribution: Distribution;
  groups: { groupId: string | null; name: string; weight: number | null; average: number | null; students: number }[];
  trend: TrendPoint[];
  atRisk: AtRiskStudent[];
}

export interface RollUp {
  courses: number;
  enrolments: number;
  averageGrade: number | null;
  submissionRate: number | null;
  onTime: number;
  late: number;
  missing: number;
  attendanceRate: number | null;
  atRisk: number;
}

export interface SchoolCourseRow extends RollUp {
  courseId: string;
  name: string;
  code: string | null;
  status: string;
  termId: string | null;
  academicYearId: string | null;
  teachers: string[];
  computedAt: string;
}

export interface SchoolAnalytics {
  lastUpdated: string | null;
  filter: { termId: string | null; academicYearId: string | null };
  filters: {
    academicYears: { id: string; name: string | null }[];
    terms: { id: string; name: string | null; academic_year_id: string | null }[];
  };
  totals: RollUp & { atRiskStudents: number };
  courses: SchoolCourseRow[];
  teachers: (RollUp & { teacherId: string; name: string })[];
}

export interface SchoolAtRisk {
  lastUpdated: string | null;
  students: (AtRiskStudent & { courseId: string; courseName: string; courseCode: string | null })[];
}

export interface AnalyticsSettings {
  rules: AtRiskRules;
  features: { attendance: boolean; mastery: boolean };
}

/** "72.5%", or "-" when there is nothing to show. */
export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "-" : `${n}%`;
}

/** Query string for the school filters (empty values left out). */
export function schoolQuery(f: { termId?: string | null; academicYearId?: string | null }): string {
  const q = new URLSearchParams();
  if (f.academicYearId) q.set("academicYearId", f.academicYearId);
  if (f.termId) q.set("termId", f.termId);
  return q.toString();
}

/** Histogram rows for charts and tables: "60-70" → count. */
export function histogramRows(d: Distribution): { label: string; count: number }[] {
  return d.histogram.map((b) => ({ label: `${b.from}-${b.to}`, count: b.count }));
}

/** A sentence describing a distribution of percents. */
export function describeDistribution(d: Distribution, noun = "students"): string {
  if (d.count === 0) return `No marks yet.`;
  const most = d.histogram.reduce((a, b) => (b.count > a.count ? b : a));
  return (
    `${d.count} ${noun}. Median ${pct(d.median)}, middle half between ${pct(d.q1)} and ${pct(d.q3)}, ` +
    `range ${pct(d.min)} to ${pct(d.max)}. Most common band: ${most.from}-${most.to}% (${most.count}).`
  );
}

/** A sentence describing the weekly trend. */
export function describeTrend(t: TrendPoint[]): string {
  if (t.length === 0) return "No marks yet.";
  if (t.length === 1) return `One week with marks (week of ${t[0].week}): average ${pct(t[0].average)}.`;
  const first = t[0];
  const last = t[t.length - 1];
  const diff = Math.round((last.average - first.average) * 10) / 10;
  const dir = diff > 0 ? `up ${diff} points` : diff < 0 ? `down ${-diff} points` : "unchanged";
  const low = t.reduce((a, b) => (b.average < a.average ? b : a));
  const high = t.reduce((a, b) => (b.average > a.average ? b : a));
  return (
    `${t.length} weeks with marks. From ${pct(first.average)} (week of ${first.week}) to ${pct(last.average)} ` +
    `(week of ${last.week}), ${dir}. Highest ${pct(high.average)} (week of ${high.week}), lowest ${pct(low.average)} (week of ${low.week}).`
  );
}

/** A sentence about submission rates across activities. */
export function describeSubmissions(acts: ActivityAnalytics[]): string {
  const due = acts.filter((a) => a.rate !== null);
  if (due.length === 0) return "Nothing is due yet.";
  const lowest = due.reduce((a, b) => ((b.rate ?? 0) < (a.rate ?? 0) ? b : a));
  return `${due.length} of ${acts.length} activities are due. Lowest submission rate: ${lowest.title} at ${pct(lowest.rate)} (${lowest.missing} missing).`;
}

/** A sentence about a list of named values (group averages, course averages). */
export function describeValues(rows: { name: string; value: number | null }[], what: string): string {
  const known = rows.filter((r): r is { name: string; value: number } => r.value !== null);
  if (known.length === 0) return `No ${what} yet.`;
  const hi = known.reduce((a, b) => (b.value > a.value ? b : a));
  const lo = known.reduce((a, b) => (b.value < a.value ? b : a));
  return known.length === 1
    ? `${hi.name}: ${pct(hi.value)}.`
    : `Highest ${what}: ${hi.name} at ${pct(hi.value)}. Lowest: ${lo.name} at ${pct(lo.value)}.`;
}

/** "Updated 5 minutes ago" style text, or a "not yet" message. */
export function lastUpdatedText(iso: string | null, now = new Date()): string {
  if (!iso) return "Not computed yet. The first refresh runs within the hour, or refresh now.";
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Updated ${new Date(iso).toLocaleDateString()}`;
}

export const RULE_LABEL: Record<RiskReason["rule"], string> = {
  grade: "Low grade",
  missing: "Missing work",
  attendance: "Attendance",
  mastery: "Mastery",
};
