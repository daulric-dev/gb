import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { StudentReportsService } from '@/report-card/student-reports.service';
import { parseParentSettings } from './parent-settings';
import { PARENT_VIEW_HIDDEN, type ChildContext } from './parent-portal.service';

/**
 * A linked child's published report cards and transcript, for the parent
 * portal. Everything goes through the report module's StudentReportsService
 * (published terms only, the child's own documents only, keys checked
 * against the school prefix), given the child ParentGuard already checked.
 * The school's `showReports` setting is enforced here (403
 * PARENT_VIEW_HIDDEN when off).
 */
@Injectable()
export class ParentReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: StudentReportsService,
  ) {}

  private async assertShown(ctx: ChildContext): Promise<void> {
    const school = await this.prisma.school.findUnique({
      where: { id: ctx.schoolId },
      select: { parent_settings: true },
    });
    if (!parseParentSettings(school?.parent_settings).showReports) {
      throw new ForbiddenException({
        statusCode: 403,
        code: PARENT_VIEW_HIDDEN,
        message: "Your child's school does not show report cards to parents",
      });
    }
  }

  async list(ctx: ChildContext) {
    await this.assertShown(ctx);
    return this.reports.publishedReportsFor(ctx.studentId);
  }

  async open(ctx: ChildContext, documentId: string) {
    await this.assertShown(ctx);
    return this.reports.openReport(ctx.studentId, documentId);
  }

  async link(ctx: ChildContext, documentId: string) {
    await this.assertShown(ctx);
    return this.reports.createDownloadLink(ctx.studentId, documentId);
  }

  /** The transcript over published terms; the same fields the student gets. */
  async transcript(ctx: ChildContext) {
    await this.assertShown(ctx);
    const doc = await this.reports.transcriptFor(ctx.studentId);
    return {
      student: { name: doc.student.name },
      terms: doc.terms,
      generatedAt: doc.generatedAt.toISOString(),
    };
  }

  async transcriptPdf(ctx: ChildContext) {
    await this.assertShown(ctx);
    return this.reports.transcriptPdfFor(ctx.studentId);
  }
}
