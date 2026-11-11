import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { TranslationOrgFeatureGuard } from './translation-feature.guard';
import { TranslationSettingsService } from './translation-settings.service';
import { TranslationService } from './translation.service';
import { ActivityTranslationService } from './activity-translation.service';
import { TranslateActivityDto, TranslateTextsDto, TranslationSettingsDto } from './translation.dto';

type Req = { user: { id: string } };

/** Per session and route: a page of UI text and content is one or a few requests. */
// Live page translation sends a few requests per page and per change (most
// answered from the cache), so the limit is per minute and generous.
export const TRANSLATE_THROTTLE = { route: { limit: 300, ttl: 60 * 1000 } };
/** Calls the saved engine (and, for LibreTranslate, the saved address): a few a minute. */
export const TEST_THROTTLE = { route: { limit: 10, ttl: 60 * 1000 } };
/** Each translated copy creates an activity and its questions. */
export const COPY_THROTTLE = { route: { limit: 5, ttl: 60 * 1000 } };

/**
 * The organisation's translation engine. Organisation admins only, behind
 * the organisation's `translation` switch; saving needs a step-up
 * confirmation and is audited.
 */
@ApiTags('Translation')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard, TranslationOrgFeatureGuard)
@Controller('organisation/translation')
export class OrganisationTranslationController {
  constructor(
    private readonly settings: TranslationSettingsService,
    private readonly translation: TranslationService,
  ) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @RequireStepUp()
  @Put()
  update(@Req() req: Req, @Body() dto: TranslationSettingsDto) {
    return this.settings.update(dto, req.user.id);
  }

  // Tests the SAVED settings only; rate-limited so it can't probe hosts.
  @Throttle(TEST_THROTTLE)
  @Post('test')
  @HttpCode(200)
  test() {
    return this.translation.test();
  }
}

/** Any signed-in user; on only where `translation` is on for their school and the organisation enabled its engine. */
@ApiTags('Translation')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('translation')
export class TranslationController {
  constructor(private readonly translation: TranslationService) {}

  @Get('status')
  status(@Req() req: Req) {
    return this.translation.status(req.user.id);
  }

  @Throttle(TRANSLATE_THROTTLE)
  @Post()
  @HttpCode(200)
  translate(@Req() req: Req, @Body() dto: TranslateTextsDto) {
    return this.translation.translateForUser(req.user.id, dto);
  }
}

/** A translated draft copy of an activity (course teachers and admins; checked by the services). */
@ApiTags('Translation')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('courses/:courseId/activities/:activityId')
export class ActivityTranslationController {
  constructor(private readonly activities: ActivityTranslationService) {}

  @Throttle(COPY_THROTTLE)
  @Post('translate')
  translate(
    @Req() req: Req,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body() dto: TranslateActivityDto,
  ) {
    return this.activities.translate(req.user.id, courseId, activityId, dto);
  }
}
