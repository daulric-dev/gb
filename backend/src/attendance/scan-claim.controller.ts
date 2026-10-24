import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { ScanClaimDto } from './dto/attendance.dto';

/**
 * The one unauthenticated attendance route. The QR on the teacher's screen
 * opens the web scan page, which may not have a signed-in student yet; it
 * swaps the short-lived token for a claim here, then sends the student
 * through sign-in and checks them in with the claim.
 */
@ApiTags('Attendance')
@Controller('attendance')
export class ScanClaimController {
  constructor(private readonly attendance: AttendanceService) {}

  // Keyed by IP for anonymous callers; generous enough for a whole class
  // behind one school NAT, tight enough to stop token guessing.
  @Throttle({ 'claim-code': { limit: 300, ttl: 60 * 1000 } })
  @Post('scan-claim')
  @HttpCode(200)
  async scanClaim(@Body() dto: ScanClaimDto) {
    return this.attendance.scanClaim(dto.sessionId, dto.qrToken);
  }
}
