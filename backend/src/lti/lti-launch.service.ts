import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { MfaService } from '@/mfa/mfa.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import { isUniqueViolation } from '@/common/db-values';
import {
  COURSE_SELECT,
  CourseAccessService,
  toCourseRow,
  type CourseRole,
} from '@/course/access/course-access.service';
import { PlatformKeyService } from './platform-key.service';
import {
  AGS_SCOPES,
  CLAIM,
  COURSE_OFFERING,
  ID_TOKEN_TTL_SECONDS,
  LAUNCH_TTL_SECONDS,
  ROLE,
  lineItemUrl,
  lineItemsUrl,
  platformIssuer,
} from './lti.constants';
import { randomToken, sha256 } from './lti-values';
import { autoPostPage, errorPage, type HtmlPage } from './lti-auth-page';

export type LaunchRole = CourseRole | 'student';

/** LIS roles for a GradeBook course role. */
export function ltiRoles(role: LaunchRole): string[] {
  switch (role) {
    case 'admin':
      return [ROLE.instructor, ROLE.administrator];
    case 'teacher':
      return [ROLE.instructor];
    case 'ta':
      return [ROLE.instructor, ROLE.teachingAssistant];
    case 'student':
      return [ROLE.learner];
  }
}

/** The parameters of the tool's authentication request (GET query or POST form). */
export type AuthParams = Record<string, unknown>;

class LaunchRefused extends Error {}

function param(p: AuthParams, name: string): string | undefined {
  const v = p[name];
  if (Array.isArray(v)) return undefined; // repeated parameter: ambiguous, refuse
  return typeof v === 'string' && v.length <= 2048 ? v : undefined;
}

/**
 * The LTI 1.3 launch, platform side (OIDC third-party initiated login):
 *
 * 1. `start` - a signed-in user opens an external tool item. GradeBook
 *    checks their course role, issues a single-use launch ticket (the
 *    `lti_message_hint`, valid five minutes, bound to that user and item)
 *    and returns the tool's login initiation URL.
 * 2. The tool redirects the browser to `authorize` (GET or POST
 *    /api/lti/auth). GradeBook checks the request against the ticket and the
 *    tool's registration, spends the ticket, records the nonce (single use)
 *    and answers with a page that auto-posts a signed id_token to the tool's
 *    registered redirect URI.
 */
@Injectable()
export class LtiLaunchService {
  private readonly logger = new Logger(LtiLaunchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly features: FeatureService,
    private readonly keys: PlatformKeyService,
    // Global (src/mfa); optional only so unit tests can leave it out.
    @Optional() private readonly mfa?: MfaService,
  ) {}

  async start(userId: string, courseId: string, moduleItemId: string) {
    const courseData = await this.prisma.course.findUnique({ where: { id: courseId }, select: COURSE_SELECT });
    if (!courseData) throw new NotFoundException('Course not found');
    const course = toCourseRow(courseData);

    const link = await this.prisma.lti_resource_link.findFirst({
      where: { module_item_id: moduleItemId, course_id: courseId },
      select: {
        id: true,
        deployment: { select: { deployment_id: true, school_id: true } },
        tool: { select: { id: true, enabled: true, client_id: true, login_url: true, target_link_uri: true } },
        module_item: { select: { is_published: true, module: { select: { is_published: true } } } },
      },
    });

    let role: LaunchRole | null = await this.access.roleIn(userId, course);
    if (!role) {
      const student = await this.prisma.student.findFirst({ where: { user_profile_id: userId }, select: { id: true } });
      if (!student) throw new NotFoundException('Course not found');
      await this.access.requireStudent(student.id, courseId);
      role = 'student';
    }
    if (!link) throw new NotFoundException('External tool item not found');
    if (role === 'student' && !(link.module_item.is_published && link.module_item.module.is_published)) {
      throw new NotFoundException('External tool item not found');
    }
    if (link.deployment.school_id !== null && link.deployment.school_id !== course.school_id) {
      throw new NotFoundException('External tool item not found');
    }
    if (!link.tool.enabled) throw new ForbiddenException('This tool has been switched off by your organisation');

    const subject = await this.prisma.lti_subject.upsert({
      where: { tool_id_user_profile_id: { tool_id: link.tool.id, user_profile_id: userId } },
      create: { tool_id: link.tool.id, user_profile_id: userId },
      update: {},
      select: { id: true },
    });

    const token = randomToken();
    const expiresAt = new Date(Date.now() + LAUNCH_TTL_SECONDS * 1000);
    await this.prisma.lti_launch.create({
      data: {
        token_hash: sha256(token),
        tool_id: link.tool.id,
        resource_link_id: link.id,
        user_profile_id: userId,
        subject_id: subject.id,
        roles: ltiRoles(role),
        expires_at: expiresAt,
      },
    });
    void this.purgeExpired();

    const url = new URL(link.tool.login_url);
    url.searchParams.set('iss', platformIssuer());
    url.searchParams.set('login_hint', subject.id);
    url.searchParams.set('target_link_uri', link.tool.target_link_uri);
    url.searchParams.set('lti_message_hint', token);
    url.searchParams.set('client_id', link.tool.client_id);
    url.searchParams.set('lti_deployment_id', link.deployment.deployment_id);
    return { url: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  /** Old tickets and replay entries; best effort, never blocks a launch. */
  private async purgeExpired() {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    try {
      await this.prisma.lti_launch.deleteMany({ where: { expires_at: { lt: cutoff } } });
      await this.prisma.lti_replay.deleteMany({ where: { expires_at: { lt: new Date() } } });
      await this.prisma.lti_access_token.deleteMany({ where: { expires_at: { lt: cutoff } } });
    } catch (error) {
      this.logger.warn(`LTI cleanup failed: ${(error as Error).message}`);
    }
  }

  /**
   * Answer the tool's authentication request. `sessionUserId` is the user of
   * a GradeBook session cookie sent with it, if any: a launch ticket is only
   * spent by the browser of the user it was issued to (when the cookie is
   * there to tell; the mobile app's in-app browser has none).
   * `sessionBlocked`: that session belongs to a deactivated account or may
   * only set up an authenticator app (AuthGuard would refuse it).
   */
  async authorize(params: AuthParams, sessionUserId: string | null, sessionBlocked = false): Promise<HtmlPage> {
    try {
      if (sessionBlocked) {
        throw new LaunchRefused('Your GradeBook session cannot open external tools. Sign in to GradeBook again.');
      }
      return await this.authorizeOrThrow(params, sessionUserId);
    } catch (error) {
      if (error instanceof LaunchRefused) {
        this.logger.warn(`LTI launch refused: ${error.message}`);
        return errorPage(400, error.message);
      }
      this.logger.error(`LTI launch failed: ${(error as Error).message}`);
      return errorPage(500, 'Something went wrong on our side.');
    }
  }

  private async authorizeOrThrow(params: AuthParams, sessionUserId: string | null): Promise<HtmlPage> {
    const clientId = param(params, 'client_id');
    const redirectUri = param(params, 'redirect_uri');
    if (!clientId || !redirectUri) throw new LaunchRefused('The request is missing client_id or redirect_uri.');

    const tool = await this.prisma.lti_tool.findUnique({
      where: { client_id: clientId },
      select: {
        id: true,
        client_id: true,
        enabled: true,
        redirect_uri_entries: { select: { redirect_uri: true } },
        target_link_uri: true,
        ags_enabled: true,
        send_name: true,
        send_email: true,
        custom_params: true,
      },
    });
    if (!tool) throw new LaunchRefused('Unknown tool.');
    // Never post a token anywhere the organisation did not register.
    if (!tool.redirect_uri_entries.some(({ redirect_uri }) => redirect_uri === redirectUri)) {
      throw new LaunchRefused('The redirect URI is not registered for this tool.');
    }

    if (param(params, 'scope') !== 'openid') throw new LaunchRefused('scope must be openid.');
    if (param(params, 'response_type') !== 'id_token') throw new LaunchRefused('response_type must be id_token.');
    if (param(params, 'response_mode') !== 'form_post') throw new LaunchRefused('response_mode must be form_post.');
    const prompt = param(params, 'prompt');
    if (prompt !== undefined && prompt !== 'none') throw new LaunchRefused('prompt must be none.');
    const nonce = param(params, 'nonce');
    if (!nonce || nonce.length > 512) throw new LaunchRefused('A nonce is required.');
    const state = param(params, 'state');
    const loginHint = param(params, 'login_hint');
    const messageHint = param(params, 'lti_message_hint');
    if (!loginHint || !messageHint) throw new LaunchRefused('The request is missing login_hint or lti_message_hint.');

    const launch = await this.prisma.lti_launch.findUnique({
      where: { token_hash: sha256(messageHint) },
      select: {
        id: true,
        tool_id: true,
        subject_id: true,
        user_profile_id: true,
        roles: true,
        expires_at: true,
        used_at: true,
        resource_link: {
          select: {
            id: true,
            custom_params: true,
            deployment: { select: { deployment_id: true } },
            module_item: { select: { title: true } },
            line_items: { select: { id: true }, take: 1 },
            course: { select: { id: true, school_id: true, name: true, code: true } },
          },
        },
      },
    });
    // Wrong tool, wrong user or a stale ticket all look the same from outside.
    if (!launch || launch.tool_id !== tool.id || launch.subject_id !== loginHint) {
      throw new LaunchRefused('This launch link is not valid. It may have expired.');
    }
    if (launch.used_at || launch.expires_at.getTime() <= Date.now()) {
      throw new LaunchRefused('This launch link has expired or was already used.');
    }
    if (sessionUserId && sessionUserId !== launch.user_profile_id) {
      throw new LaunchRefused('This launch was started by a different account.');
    }
    if (!tool.enabled) throw new LaunchRefused('This tool has been switched off by your organisation.');
    // The ticket's user, whatever browser spends it: never a deactivated
    // account, nor one the organisation requires an authenticator app of who
    // has none (both are refused by AuthGuard everywhere else).
    const owner = await this.prisma.user_profile.findUnique({
      where: { id: launch.user_profile_id },
      select: { is_active: true },
    });
    if (!owner || owner.is_active === false) throw new LaunchRefused('This account is deactivated.');
    if (this.mfa && (await this.mfa.enrolmentRequired(launch.user_profile_id))) {
      throw new LaunchRefused('Set up two-step verification in GradeBook before opening external tools.');
    }
    const course = launch.resource_link.course;
    if (!(await this.features.isEnabled(course.school_id, 'lti'))) {
      throw new LaunchRefused('External tools are turned off for your school.');
    }

    // Spend the ticket: one conditional update, so two racing requests
    // cannot both succeed.
    const spent = await this.prisma.lti_launch.updateMany({
      where: { id: launch.id, used_at: null, expires_at: { gt: new Date() } },
      data: { used_at: new Date() },
    });
    if (spent.count !== 1) throw new LaunchRefused('This launch link has expired or was already used.');

    // A nonce is good for one id_token per tool.
    try {
      await this.prisma.lti_replay.create({
        data: {
          tool_id: tool.id,
          kind: 'nonce',
          value: nonce,
          expires_at: new Date(Date.now() + 2 * ID_TOKEN_TTL_SECONDS * 1000),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new LaunchRefused('This nonce was already used.');
      throw error;
    }

    const claims = await this.claims({ tool, launch: { ...launch, roles: stringList(launch.roles) }, nonce });
    const idToken = await this.keys.sign(claims);
    return autoPostPage(redirectUri, state === undefined ? { id_token: idToken } : { id_token: idToken, state });
  }

  private async claims(args: {
    tool: {
      client_id: string;
      target_link_uri: string;
      ags_enabled: boolean;
      send_name: boolean;
      send_email: boolean;
      custom_params: unknown;
    };
    launch: {
      subject_id: string;
      user_profile_id: string;
      roles: string[];
      resource_link: {
        id: string;
        custom_params: unknown;
        deployment: { deployment_id: string };
        module_item: { title: string | null };
        line_items: { id: string }[];
        course: { id: string; name: string; code: string | null };
      };
    };
    nonce: string;
  }) {
    const { tool, launch, nonce } = args;
    const link = launch.resource_link;
    const now = Math.floor(Date.now() / 1000);
    const [organisation, profile] = await Promise.all([
      this.prisma.organisation.findFirst({ select: { id: true, name: true } }),
      tool.send_name || tool.send_email
        ? this.prisma.user_profile.findUnique({
            where: { id: launch.user_profile_id },
            select: { first_name: true, last_name: true, email: true, app_user: { select: { email: true } } },
          })
        : Promise.resolve(null),
    ]);

    const claims: Record<string, unknown> = {
      iss: platformIssuer(),
      aud: tool.client_id,
      azp: tool.client_id,
      sub: launch.subject_id,
      iat: now,
      exp: now + ID_TOKEN_TTL_SECONDS,
      nonce,
      [CLAIM.messageType]: 'LtiResourceLinkRequest',
      [CLAIM.version]: '1.3.0',
      [CLAIM.deploymentId]: link.deployment.deployment_id,
      [CLAIM.targetLinkUri]: tool.target_link_uri,
      [CLAIM.resourceLink]: { id: link.id, title: link.module_item.title ?? undefined },
      [CLAIM.roles]: launch.roles,
      [CLAIM.context]: {
        id: link.course.id,
        label: link.course.code ?? link.course.name,
        title: link.course.name,
        type: [COURSE_OFFERING],
      },
      [CLAIM.toolPlatform]: {
        guid: organisation?.id ?? platformIssuer(),
        name: organisation?.name ?? 'GradeBook',
        product_family_code: 'gradebook',
      },
      [CLAIM.launchPresentation]: { document_target: 'window' },
      [CLAIM.custom]: {
        ...((tool.custom_params ?? {}) as Record<string, string>),
        ...((link.custom_params ?? {}) as Record<string, string>),
      },
    };
    if (tool.ags_enabled) {
      claims[CLAIM.agsEndpoint] = {
        scope: AGS_SCOPES,
        lineitems: lineItemsUrl(link.course.id),
        ...(link.line_items[0] ? { lineitem: lineItemUrl(link.course.id, link.line_items[0].id) } : {}),
      };
    }
    if (profile && tool.send_name) {
      const given = profile.first_name?.trim() || undefined;
      const family = profile.last_name?.trim() || undefined;
      claims.given_name = given;
      claims.family_name = family;
      claims.name = [given, family].filter(Boolean).join(' ') || undefined;
    }
    if (profile && tool.send_email) {
      claims.email = profile.app_user?.email ?? profile.email ?? undefined;
    }
    return claims;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
