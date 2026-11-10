import type { PrismaService } from '@/prisma/prisma.service';
import { calculateMastery, evidenceLevel, scaleFromRow } from './mastery.calc';

/** One outcome line on a report card. */
export interface ReportOutcomeLine {
  code: string;
  title: string;
  /** The level label, or null without evidence. */
  label: string | null;
  mastered: boolean;
}

/**
 * The outcomes section of one student's report card, per course id, for
 * schools with `report_card_section` on (the caller checks the `mastery`
 * feature). Evidence up to `until` (the term's last day, for year-long
 * courses reported per term) counts; outcomes without any evidence in the
 * period are left off. An empty map when the school has the section off.
 */
export async function loadReportOutcomes(
  prisma: PrismaService,
  schoolId: string,
  studentId: string,
  courseIds: string[],
  until: Date | null,
): Promise<Map<string, ReportOutcomeLine[]>> {
  const out = new Map<string, ReportOutcomeLine[]>();
  if (courseIds.length === 0) return out;
  const row = await prisma.mastery_setting.findUnique({ where: { school_id: schoolId } });
  if (!row?.report_card_section) return out;
  const scale = scaleFromRow(row);
  const evidence = await prisma.outcome_evidence.findMany({
    where: {
      student_id: studentId,
      course_id: { in: courseIds },
      ...(until ? { assessed_at: { lte: until } } : {}),
    },
    select: {
      course_id: true,
      outcome_id: true,
      ratio: true,
      rating_rank: true,
      rating_count: true,
      assessed_at: true,
      outcome: { select: { code: true, title: true, position: true, course_id: true } },
    },
  });
  const groups = new Map<
    string,
    { courseId: string; outcome: { code: string; title: string; position: number; course_id: string | null }; items: { level: number; at: Date }[] }
  >();
  for (const e of evidence ?? []) {
    const key = `${e.course_id}:${e.outcome_id}`;
    const g = groups.get(key) ?? { courseId: e.course_id, outcome: e.outcome, items: [] };
    g.items.push({
      level: evidenceLevel({ ratio: e.ratio, ratingRank: e.rating_rank, ratingCount: e.rating_count }, scale),
      at: new Date(e.assessed_at),
    });
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort(
    (a, b) =>
      Number(!a.outcome.course_id) - Number(!b.outcome.course_id) ||
      a.outcome.position - b.outcome.position ||
      a.outcome.code.localeCompare(b.outcome.code),
  );
  for (const g of sorted) {
    const result = calculateMastery(g.items, scale);
    const list = out.get(g.courseId) ?? [];
    list.push({ code: g.outcome.code, title: g.outcome.title, label: result.label, mastered: result.mastered });
    out.set(g.courseId, list);
  }
  return out;
}
