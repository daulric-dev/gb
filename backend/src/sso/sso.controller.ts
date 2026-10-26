import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AuthGuard } from '@/auth/auth.guard';
import { SsoService } from './sso.service';

class DiscoverQueryDto {
  @IsEmail() @MaxLength(320) email!: string;
}

class StartQueryDto {
  @IsOptional() @IsString() @MaxLength(2048) next?: string;
  @IsOptional() @IsIn(['web', 'mobile']) platform?: 'web' | 'mobile';
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  /**
   * Mobile: base64url(SHA-256(code_verifier)). Required there; a mobile start
   * without one (a build from before PKCE) is sent back to the app with an
   * "update the app" error, a malformed one is a 400.
   */
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{43}$/) code_challenge?: string;
}

class HandoffDto {
  @IsString() @MaxLength(128) code!: string;
  /** The verifier for the code_challenge the app sent to /start. */
  @IsString() @Matches(/^[A-Za-z0-9._~-]{43,128}$/) code_verifier!: string;
}

/**
 * Single sign-on. Starting and finishing a sign-in are plain browser
 * navigations (redirects), not API calls: the provider sends the browser
 * back here, and here sends it on to the app.
 */
@ApiTags('Auth')
@Controller('auth/sso')
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  /** The providers this deployment offers, for the login buttons. */
  @Get('providers')
  providers() {
    return this.sso.providers();
  }

  /** Whether an address's school has its own provider, and requires it. */
  @Throttle({ 'auth-ip': { limit: 300, ttl: 60 * 60 * 1000 } })
  @Get('discover')
  async discover(@Query() query: DiscoverQueryDto) {
    return this.sso.discover(query.email);
  }

  /** Our SAML service provider metadata, for schools to give their IdP. */
  @Get('saml/metadata')
  samlMetadata(@Res() reply: FastifyReply) {
    const xml = this.sso.samlMetadata();
    if (!xml) throw new NotFoundException('SAML sign-in is not enabled');
    return reply
      .header('Content-Type', 'application/samlmetadata+xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(xml);
  }

  /**
   * SAML assertion consumer service: the IdP's form POST
   * (application/x-www-form-urlencoded, SAMLResponse + RelayState).
   */
  @Throttle({ 'auth-ip': { limit: 120, ttl: 60 * 60 * 1000 } })
  @Post('saml/acs')
  async samlAcs(
    @Res() reply: FastifyReply,
    @Body() body: Record<string, unknown>,
  ) {
    const url = await this.sso.samlAcs(body ?? {});
    // 303: the browser follows with a GET.
    return reply.redirect(url, 303);
  }

  @Throttle({ 'auth-ip': { limit: 120, ttl: 60 * 60 * 1000 } })
  @Get(':provider/start')
  async start(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('provider') provider: string,
    @Query() query: StartQueryDto,
  ) {
    const url = await this.sso.start(req, reply, provider, query);
    return reply.redirect(url, 302);
  }

  @Get('callback')
  async callback(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Query() query: Record<string, string | undefined>,
  ) {
    const url = await this.sso.callback(req, reply, query);
    return reply.redirect(url, 302);
  }

  /**
   * The mobile app trades its one-time code, plus the verifier for the
   * challenge it started with, for a session.
   */
  @Throttle({ 'auth-ip': { limit: 60, ttl: 60 * 60 * 1000 } })
  @Post('handoff')
  @HttpCode(204)
  async handoff(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() dto: HandoffDto,
  ) {
    await this.sso.handoff(req, reply, dto.code, dto.code_verifier);
  }

  /** Names from the provider, to prefill onboarding. */
  @UseGuards(AuthGuard)
  @Get('suggested-profile')
  async suggestedProfile(@Req() req: FastifyRequest & { user?: { id: string } }) {
    const userId = req.user?.id;
    return { profile: userId ? await this.sso.suggestedProfile(userId) : null };
  }
}
