import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { AdminGuard } from '@/auth/admin.guard';
import { EmailDomainService } from './email-domain.service';
import { AddEmailDomainDto, UpdateEmailDomainDto } from './dto/email-domain.dto';

/** The school admin's list of email domains. */
@ApiTags('School')
@ApiBearerAuth()
@Controller('schools/email-domains')
@UseGuards(AuthGuard, AdminGuard)
export class EmailDomainController {
  constructor(private readonly domains: EmailDomainService) {}

  @Get()
  async list(@Req() req: any) {
    return this.domains.list(req.user.id as string);
  }

  @Post()
  async add(@Req() req: any, @Body() dto: AddEmailDomainDto) {
    return this.domains.add(req.user.id as string, dto);
  }

  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmailDomainDto,
  ) {
    return this.domains.update(req.user.id as string, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    await this.domains.remove(req.user.id as string, id);
  }

  // A DNS lookup per call; no reason to let it be hammered.
  @Throttle({ 'claim-code': { limit: 20, ttl: 15 * 60 * 1000 } })
  @Post(':id/verify')
  @HttpCode(200)
  async verify(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.verify(req.user.id as string, id);
  }
}

/**
 * The signed-in user's side: is there a school for my address, and join it.
 * The address is the one AuthGuard took from the session, never the body.
 */
@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth/email-domain')
@UseGuards(AuthGuard)
export class EmailDomainJoinController {
  constructor(private readonly domains: EmailDomainService) {}

  @Get('match')
  async match(@Req() req: any) {
    const match = await this.domains.matchFor(req.user.id as string, req.user.email);
    return { match };
  }

  @Throttle({ 'claim-code': { limit: 10, ttl: 15 * 60 * 1000 } })
  @Post('join')
  @HttpCode(200)
  async join(@Req() req: any) {
    return this.domains.join(req.user.id as string, req.user.email);
  }
}
