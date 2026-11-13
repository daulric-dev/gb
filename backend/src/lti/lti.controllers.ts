import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { RequireFeature } from '@/features/require-feature.decorator';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { SessionService, sessionTokenVia } from '@/account/session.service';
import { PrismaService } from '@/prisma/prisma.service';
import { MfaService } from '@/mfa/mfa.service';
import { LtiToolService } from './lti-tool.service';
import { LtiLinkService } from './lti-link.service';
import { LtiLaunchService } from './lti-launch.service';
import { PlatformKeyService } from './platform-key.service';
import {
  LtiRateLimitedException,
  LtiRateLimiter,
  LtiTokenService,
  OAuthError,
  type AgsCaller,
} from './lti-token.service';
import { LtiAgsService } from './lti-ags.service';
import { MEDIA } from './lti.constants';
import {
  AddLtiDeploymentDto,
  CreateLtiItemDto,
  CreateLtiToolDto,
  StartLtiLaunchDto,
  UpdateLtiItemDto,
  UpdateLtiToolDto,
} from './dto/lti.dto';

type UserReq = { user: { id: string } };

/**
 * Organisation routes have no school: `lti` must be on for the organisation
 * itself (FeatureGuard would read the admin's own school instead).
 */
@Injectable()
export class LtiOrganisationFeatureGuard implements CanActivate {
  constructor(private readonly features: FeatureService) {}

  async canActivate(): Promise<boolean> {
    if (!(await this.features.isEnabled(null, 'lti'))) throw new FeatureDisabledException('lti');
    return true;
  }
}

/** The tool registry and platform keys, for organisation admins. Writes need step-up. */
@ApiTags('LTI')
@ApiBearerAuth()
@UseGuards(AuthGuard, OrganisationAdminGuard, LtiOrganisationFeatureGuard)
@Controller('organisation/lti')
export class LtiAdminController {
  constructor(private readonly tools: LtiToolService) {}

  @Get()
  async overview() {
    const [platform, tools] = await Promise.all([this.tools.platform(), this.tools.list()]);
    return { platform, tools };
  }

  @Get('tools/:toolId')
  async get(@Param('toolId', ParseUUIDPipe) toolId: string) {
    return this.tools.get(toolId);
  }

  @RequireStepUp()
  @Post('tools')
  async create(@Req() req: UserReq, @Body() dto: CreateLtiToolDto) {
    return this.tools.create(req.user.id, dto);
  }

  @RequireStepUp()
  @Patch('tools/:toolId')
  async update(@Req() req: UserReq, @Param('toolId', ParseUUIDPipe) toolId: string, @Body() dto: UpdateLtiToolDto) {
    return this.tools.update(req.user.id, toolId, dto);
  }

  @RequireStepUp()
  @Delete('tools/:toolId')
  @HttpCode(204)
  async remove(@Req() req: UserReq, @Param('toolId', ParseUUIDPipe) toolId: string) {
    await this.tools.remove(req.user.id, toolId);
  }

  @RequireStepUp()
  @Post('tools/:toolId/deployments')
  async addDeployment(
    @Req() req: UserReq,
    @Param('toolId', ParseUUIDPipe) toolId: string,
    @Body() dto: AddLtiDeploymentDto,
  ) {
    return this.tools.addDeployment(req.user.id, toolId, dto.schoolId ?? null);
  }

  @RequireStepUp()
  @Delete('tools/:toolId/deployments/:deploymentId')
  async removeDeployment(
    @Req() req: UserReq,
    @Param('toolId', ParseUUIDPipe) toolId: string,
    @Param('deploymentId', ParseUUIDPipe) deploymentId: string,
  ) {
    return this.tools.removeDeployment(req.user.id, toolId, deploymentId);
  }

  @RequireStepUp()
  @Post('keys/rotate')
  async rotate(@Req() req: UserReq) {
    return this.tools.rotateKey(req.user.id);
  }
}

/**
 * External tool items inside a course, and launching one. Staff manage
 * items (course role, as for every module item); staff and enrolled
 * students launch. `lti` must be on for the course's school.
 */
@ApiTags('LTI')
@ApiBearerAuth()
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('lti')
@Controller('courses/:courseId/lti')
export class LtiCourseController {
  constructor(
    private readonly links: LtiLinkService,
    private readonly launches: LtiLaunchService,
  ) {}

  @Get('tools')
  async tools(@Req() req: UserReq, @Param('courseId', ParseUUIDPipe) courseId: string) {
    return this.links.availableTools(req.user.id, courseId);
  }

  @Post('modules/:moduleId/items')
  async createItem(
    @Req() req: UserReq,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('moduleId', ParseUUIDPipe) moduleId: string,
    @Body() dto: CreateLtiItemDto,
  ) {
    return this.links.createItem(req.user.id, courseId, moduleId, dto);
  }

  @Get('items/:itemId')
  async item(
    @Req() req: UserReq,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.links.getItem(req.user.id, courseId, itemId);
  }

  @Patch('items/:itemId')
  async updateItem(
    @Req() req: UserReq,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateLtiItemDto,
  ) {
    return this.links.updateItem(req.user.id, courseId, itemId, dto.customParams ?? {});
  }

  @Throttle({ route: { limit: 60, ttl: 60_000 } })
  @Post('launches')
  async launch(
    @Req() req: UserReq,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: StartLtiLaunchDto,
  ) {
    return this.launches.start(req.user.id, courseId, dto.moduleItemId);
  }
}

/**
 * The public LTI endpoints a tool talks to: the platform JWKS, the OIDC
 * authentication endpoint (GET or a cross-site form POST, the one CSRF
 * exemption, see common/csrf.ts) and the AGS token endpoint.
 */
@ApiTags('LTI')
@Controller('lti')
export class LtiPublicController {
  constructor(
    private readonly keys: PlatformKeyService,
    private readonly launches: LtiLaunchService,
    private readonly tokens: LtiTokenService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
  ) {}

  @Get('jwks')
  async jwks(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'public, max-age=300');
    return this.keys.jwks();
  }

  /**
   * The signed-in user behind this launch, held to the same checks as
   * AuthGuard: a session of a deactivated account, or one limited to setting
   * up an authenticator app (src/mfa), is `blocked` and the launch refused.
   */
  async sessionUser(req: FastifyRequest): Promise<{ userId: string | null; blocked: boolean }> {
    if (sessionTokenVia(req) !== 'cookie') return { userId: null, blocked: false };
    let session;
    try {
      session = await this.sessions.resolve(req);
    } catch {
      return { userId: null, blocked: false };
    }
    if (!session) return { userId: null, blocked: false };
    try {
      const profile = await this.prisma.user_profile.findUnique({
        where: { id: session.userId },
        select: { is_active: true },
      });
      const blocked =
        !profile || profile.is_active === false || !(await this.mfa.sessionUsable(session.userId, session.sessionId));
      return { userId: session.userId, blocked };
    } catch {
      // Fail closed: the checks could not be made.
      return { userId: session.userId, blocked: true };
    }
  }

  @Throttle({ 'auth-ip': { limit: 300, ttl: 60 * 60 * 1000 } })
  @Get('auth')
  async authGet(@Req() req: FastifyRequest, @Res() reply: FastifyReply, @Query() query: Record<string, unknown>) {
    const { userId, blocked } = await this.sessionUser(req);
    const page = await this.launches.authorize(query ?? {}, userId, blocked);
    return reply.code(page.status).headers(page.headers).send(page.body);
  }

  @Throttle({ 'auth-ip': { limit: 300, ttl: 60 * 60 * 1000 } })
  @Post('auth')
  async authPost(@Req() req: FastifyRequest, @Res() reply: FastifyReply, @Body() body: Record<string, unknown>) {
    const { userId, blocked } = await this.sessionUser(req);
    const page = await this.launches.authorize(body ?? {}, userId, blocked);
    return reply.code(page.status).headers(page.headers).send(page.body);
  }

  @Throttle({ 'auth-ip': { limit: 600, ttl: 60 * 60 * 1000 } })
  @Post('token')
  async token(@Res() reply: FastifyReply, @Body() body: Record<string, unknown>) {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    try {
      return reply.code(200).send(await this.tokens.issue(body ?? {}));
    } catch (error) {
      if (error instanceof OAuthError) {
        return reply.code(error.status).send({ error: error.error, error_description: error.description });
      }
      throw error;
    }
  }
}

/** AGS bearer token check plus the per-tool rate limit; puts the caller on `req.ltiTool`. */
@Injectable()
export class LtiAgsGuard implements CanActivate {
  constructor(
    private readonly tokens: LtiTokenService,
    private readonly limiter: LtiRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { ltiTool?: AgsCaller }>();
    const header: string | string[] | undefined = req.headers.authorization;
    const caller = await this.tokens.resolve((Array.isArray(header) ? header[0] : header) as string);
    if (!caller) throw new UnauthorizedException('A valid LTI access token is required');
    if (!(await this.limiter.allow(caller.toolId))) throw new LtiRateLimitedException();
    req.ltiTool = caller;
    return true;
  }
}

type AgsReq = { ltiTool: AgsCaller };

/** Assignment and Grade Services (line items, scores, results) for tools. */
@ApiExcludeController()
@UseGuards(LtiAgsGuard)
@Controller('lti/ags/courses/:courseId/lineitems')
export class LtiAgsController {
  constructor(private readonly ags: LtiAgsService) {}

  @Get()
  async list(
    @Req() req: AgsReq,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const str = (k: string) => (typeof query?.[k] === 'string' ? (query[k]) : undefined);
    const limit = Number(str('limit'));
    reply.header('Content-Type', MEDIA.lineItemContainer);
    return this.ags.listLineItems(req.ltiTool, courseId, {
      resourceLinkId: str('resource_link_id'),
      tag: str('tag'),
      resourceId: str('resource_id'),
      limit: Number.isInteger(limit) ? limit : undefined,
    });
  }

  @Post()
  async create(
    @Req() req: AgsReq,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() body: unknown,
  ) {
    reply.header('Content-Type', MEDIA.lineItem);
    return this.ags.createLineItem(req.ltiTool, courseId, body);
  }

  @Get(':lineItemId')
  async get(
    @Req() req: AgsReq,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lineItemId', ParseUUIDPipe) lineItemId: string,
  ) {
    reply.header('Content-Type', MEDIA.lineItem);
    return this.ags.getLineItem(req.ltiTool, courseId, lineItemId);
  }

  @Post(':lineItemId/scores')
  @HttpCode(204)
  async score(
    @Req() req: AgsReq,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lineItemId', ParseUUIDPipe) lineItemId: string,
    @Body() body: unknown,
  ) {
    await this.ags.postScore(req.ltiTool, courseId, lineItemId, body);
  }

  @Get(':lineItemId/results')
  async results(
    @Req() req: AgsReq,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('lineItemId', ParseUUIDPipe) lineItemId: string,
    @Query() query: Record<string, unknown>,
  ) {
    reply.header('Content-Type', MEDIA.resultContainer);
    const limit = Number(query?.limit);
    return this.ags.results(req.ltiTool, courseId, lineItemId, {
      userId: typeof query?.user_id === 'string' ? query.user_id : undefined,
      limit: Number.isInteger(limit) ? limit : undefined,
    });
  }
}
