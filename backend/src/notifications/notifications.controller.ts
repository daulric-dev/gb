import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { PushService } from './push.service';
import { RegisterPushDeviceDto } from './dto/push-device.dto';

/** Push devices for any signed-in user, staff or student. */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly push: PushService) {}

  /**
   * Register this device's token for the caller's session. Taking over a
   * token another user holds needs that user's sign-in to have ended.
   */
  @Post('devices')
  @HttpCode(204)
  async register(@Req() req: any, @Body() dto: RegisterPushDeviceDto) {
    await this.push.register(
      req.user.id as string,
      dto.token,
      dto.platform,
      (req.user.sessionId as string | undefined) ?? null,
    );
  }

  @Delete('devices/:token')
  @HttpCode(204)
  async unregister(@Req() req: any, @Param('token') token: string) {
    await this.push.unregister(req.user.id as string, token);
  }
}
