import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { FeatureService } from '@/features/feature.service';
import { PrismaService } from '@/prisma/prisma.service';
import { getClientIp, type ThrottlerReq } from '@/throttle/tracker';
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
  constructor(
    private readonly attendance: AttendanceService,
    private readonly features: FeatureService,
    private readonly prisma: PrismaService,
  ) {}

  // Keyed by IP for anonymous callers; generous enough for a whole class
  // behind one school NAT, tight enough to stop token guessing.
  @Throttle({ 'claim-code': { limit: 300, ttl: 60 * 1000 } })
  @Post('scan-claim')
  @HttpCode(200)
  async scanClaim(@Body() dto: ScanClaimDto, @Req() req: ThrottlerReq) {
    // Public: the school comes from the session's course. An unknown session
    // falls through to the service's own error.
    const session = await this.prisma.attendance_session
      .findUnique({
        where: { id: dto.sessionId },
        select: { course: { select: { school_id: true } } },
      })
      .catch(() => null);
    if (session?.course) {
      await this.features.assertEnabled(session.course.school_id, 'attendance');
    }
    // The service also caps claims per session and client address.
    return this.attendance.scanClaim(
      dto.sessionId,
      dto.qrToken,
      getClientIp(req),
    );
  }
}
