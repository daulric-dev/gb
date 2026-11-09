import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { ParentGuard, type ParentRequest } from './parent.guard';
import { ParentPortalService, type ChildContext } from './parent-portal.service';
import { ParentNotificationService } from './parent-notification.service';
import { ParentLinkService } from './parent-link.service';
import {
  AcceptParentInviteDto,
  ParentNotificationPrefsDto,
  RedeemLinkCodeDto,
} from './dto/parent.dto';

const child = (req: ParentRequest): ChildContext => ({
  studentId: req.parent!.studentId!,
  schoolId: req.parent!.schoolId!,
});

/**
 * The parent's read-only view of their linked children. Every route needs
 * `parent_portal` for the child's school (a method's keys replace the
 * class's, so each override repeats it).
 */
@ApiTags('Parent Portal')
@ApiBearerAuth()
@Controller('parent')
@UseGuards(AuthGuard, ParentGuard, FeatureGuard)
@RequireFeature('parent_portal')
export class ParentPortalController {
  constructor(
    private readonly portal: ParentPortalService,
    private readonly notices: ParentNotificationService,
  ) {}

  @Get('children')
  children(@Req() req: ParentRequest) {
    return this.portal.children(req.parent!.userId);
  }

  @Get('children/:studentId')
  overview(@Req() req: ParentRequest) {
    return this.portal.overview(child(req));
  }

  @Get('children/:studentId/courses')
  courses(@Req() req: ParentRequest) {
    return this.portal.courses(child(req));
  }

  @Get('children/:studentId/courses/:courseId/grades')
  grades(@Req() req: ParentRequest, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.portal.courseGrades(child(req), courseId);
  }

  @Get('children/:studentId/work')
  work(@Req() req: ParentRequest) {
    return this.portal.work(child(req));
  }

  @RequireFeature('parent_portal', 'attendance')
  @Get('children/:studentId/attendance')
  attendance(@Req() req: ParentRequest) {
    return this.portal.attendance(child(req));
  }

  @RequireFeature('parent_portal', 'announcements')
  @Get('children/:studentId/announcements')
  announcements(@Req() req: ParentRequest) {
    return this.portal.announcementsFor(child(req));
  }

  @RequireFeature('parent_portal', 'parent_notifications')
  @Get('notifications/preferences')
  getPrefs(@Req() req: ParentRequest) {
    return this.notices.getPrefs(req.parent!.userId);
  }

  @RequireFeature('parent_portal', 'parent_notifications')
  @Put('notifications/preferences')
  setPrefs(@Req() req: ParentRequest, @Body() dto: ParentNotificationPrefsDto) {
    return this.notices.setPrefs(req.parent!.userId, dto);
  }
}

/**
 * Redeeming an invitation. Any signed-in user may call these (they are how
 * an account becomes a parent); the invitation's school must have
 * `parent_portal` on, checked in the service.
 */
@ApiTags('Parent Portal')
@ApiBearerAuth()
@Controller('parent/link')
@UseGuards(AuthGuard)
export class ParentLinkController {
  constructor(private readonly links: ParentLinkService) {}

  @Throttle({ 'claim-code': { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('accept')
  @HttpCode(200)
  accept(@Req() req: ParentRequest, @Body() dto: AcceptParentInviteDto) {
    return this.links.accept(req.user!, dto);
  }

  @Throttle({ 'claim-code': { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('redeem')
  @HttpCode(200)
  redeem(@Req() req: ParentRequest, @Body() dto: RedeemLinkCodeDto) {
    return this.links.redeemCode(req.user!, dto);
  }
}
