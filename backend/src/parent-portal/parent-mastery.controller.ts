import { Controller, ForbiddenException, Get, Injectable, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { PrismaService } from '@/prisma/prisma.service';
import { MasteryService } from '@/mastery/mastery.service';
import { ParentGuard, type ParentRequest } from './parent.guard';
import { parseParentSettings } from './parent-settings';
import { PARENT_VIEW_HIDDEN, type ChildContext } from './parent-portal.service';

/**
 * A linked child's mastery of learning outcomes, through the mastery
 * module's `studentOutcomes` (the same fields the student sees: no
 * feedback, answers or other students). The school's `showMastery` parent
 * setting (default off) is enforced here: 403 PARENT_VIEW_HIDDEN, nothing
 * read.
 */
@Injectable()
export class ParentMasteryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mastery: MasteryService,
  ) {}

  async outcomes(ctx: ChildContext) {
    const school = await this.prisma.school.findUnique({
      where: { id: ctx.schoolId },
      select: { parent_settings: true },
    });
    if (!parseParentSettings(school?.parent_settings).showMastery) {
      throw new ForbiddenException({
        statusCode: 403,
        code: PARENT_VIEW_HIDDEN,
        message: "Your child's school does not show outcomes to parents",
      });
    }
    return this.mastery.studentOutcomes(ctx.studentId);
  }
}

/** Needs `parent_portal` and `mastery` for the child's school, and `showMastery`. */
@ApiTags('Parent Portal')
@ApiBearerAuth()
@Controller('parent/children/:studentId')
@UseGuards(AuthGuard, ParentGuard, FeatureGuard)
@RequireFeature('parent_portal', 'mastery')
export class ParentMasteryController {
  constructor(private readonly mastery: ParentMasteryService) {}

  @Get('outcomes')
  outcomes(@Req() req: ParentRequest) {
    return this.mastery.outcomes({ studentId: req.parent!.studentId!, schoolId: req.parent!.schoolId! });
  }
}
