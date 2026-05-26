import { Module, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { VersioningGuard } from '@/versioning/versioning.guard';
import { SupabaseModule } from '@/supabase/supabase.module';
import { AuthModule } from '@/auth/auth.module';
import { ClassModule } from '@/class/class.module';
import { AcademicYearModule } from '@/academic-year/academic-year.module';
import { SchoolModule } from '@/school/school.module';
import { StudentModule } from '@/student/student.module';
import { SubjectModule } from '@/subject/subject.module';
import { TermModule } from '@/term/term.module';
import { EnrollmentModule } from '@/enrollment/enrollment.module';
import { AttendanceModule } from '@/attendance/attendance.module';
import { GradingModule } from '@/grading/grading.module';
import { GradeScaleModule } from '@/grade-scale/grade-scale.module';
import { CalculationModule } from '@/calculation/calculation.module';
import { ReportingModule } from '@/reporting/reporting.module';
import { ImagesModule } from '@/images/images.module';
import { CacheModule } from '@/cache/cache.module';
import { PaginationModule } from '@/pagination/pagination.module';
import { VersioningModule } from '@/versioning/versioning.module';

type ThrottlerReq = {
  body?: { email?: string };
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  ip?: string;
};

// Extract real client IP from X-Forwarded-For header
function getClientIp(req: ThrottlerReq): string | undefined {
  if (!req.headers) return req.ip;
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0];
  }
  return req.ip;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 22);
}

function getSessionTracker(req: ThrottlerReq): string | undefined {
  const auth = req.headers?.['authorization'];
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) return `u:${fingerprint(match[1].trim())}`;
  }

  if (req.cookies) {
    const parts: string[] = [];
    for (const [name, value] of Object.entries(req.cookies)) {
      if (!name.startsWith('sb-') || !name.includes('auth-token')) continue;
      parts.push(`${name}=${value ?? ''}`);
    }
    if (parts.length > 0) {
      return `u:${fingerprint(parts.sort().join('&'))}`;
    }
  }

  return undefined;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: process.env.NODE_ENV === 'production' ? 300 : 1000,
          getTracker: (req: ThrottlerReq) =>
            getSessionTracker(req) ?? `ip:${getClientIp(req) ?? 'unknown'}`,
        },
        {
          name: 'auth-strict',
          ttl: 60 * 60 * 1000,
          limit: process.env.NODE_ENV === 'production' ? 5 : 100,
          getTracker: (req: ThrottlerReq) =>
            req.body?.email?.toLowerCase() ?? getClientIp(req) ?? 'unknown',
        },
      ],

      generateKey: (
        _context: ExecutionContext,
        tracker: string,
        throttlerName: string,
      ) => `${throttlerName}:${tracker}`,
    }),

    SupabaseModule,
    AuthModule,
    CacheModule,
    PaginationModule,
    VersioningModule,
    ClassModule,

    AcademicYearModule,
    SchoolModule,
    StudentModule,
    SubjectModule,
    TermModule,
    EnrollmentModule,
    AttendanceModule,
    GradingModule,
    GradeScaleModule,
    CalculationModule,
    ReportingModule,
    ImagesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: VersioningGuard,
    },
  ],
})
export class AppModule {}
