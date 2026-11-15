import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from '@/auth/public.decorator';

/** Liveness only: Caddy's active health check polls it. */
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
