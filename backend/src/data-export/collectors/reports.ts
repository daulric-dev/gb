import type { Collector, ExportObject } from '../data-export.types';
import { safeName, studentIn } from './helpers';

/**
 * Generated term report PDFs. Self and parent exports get the reports of
 * published terms only (what the portals show); staff exports get every
 * generated report.
 */
export const reportsCollector: Collector = {
  id: 'reports',
  title: 'Report cards',
  description: 'Term report cards generated for the student, as PDFs copied into files/reports/.',
  covers: ['grading.report_document.student_id'],
  scopes: ['self', 'staff', 'parent'],
  parentSetting: 'showReports',
  async collect(ctx) {
    if (ctx.subject.studentIds.length === 0) return { data: [], count: 0 };
    const docs = await ctx.prisma.report_document.findMany({
      where: {
        student_id: studentIn(ctx),
        status: 'ready',
        storage_key: { not: null },
        ...(ctx.subject.schoolId ? { school_id: ctx.subject.schoolId } : {}),
      },
      select: { term_id: true, school_id: true, storage_key: true, byte_size: true, generated_at: true },
    });
    let visible = docs;
    if (ctx.subject.scope !== 'staff' && docs.length > 0) {
      const released = await ctx.prisma.report_release.findMany({
        where: { term_id: { in: docs.map((d) => d.term_id) }, published_at: { not: null } },
        select: { term_id: true, school_id: true },
      });
      const ok = new Set(released.map((r) => `${r.school_id}:${r.term_id}`));
      visible = docs.filter((d) => ok.has(`${d.school_id}:${d.term_id}`));
    }
    const terms = visible.length
      ? await ctx.prisma.term.findMany({
          where: { id: { in: visible.map((d) => d.term_id) } },
          select: { id: true, name: true },
        })
      : [];
    const termName = new Map(terms.map((t) => [t.id, t.name]));
    const objects: ExportObject[] = [];
    const data = visible.map((d, i) => {
      const path = `files/reports/${i + 1}-${safeName(termName.get(d.term_id), 'term')}.pdf`;
      objects.push({ path, key: d.storage_key!, size: d.byte_size });
      return { term: termName.get(d.term_id) ?? null, generatedAt: d.generated_at, copiedTo: path };
    });
    return { data, count: data.length, objects };
  },
};
