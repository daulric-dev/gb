import { Module, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  getClientIp,
  getSessionTracker,
  type ThrottlerReq,
} from '@/throttle/tracker';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { VersioningGuard } from '@/versioning/versioning.guard';
import { SupabaseModule } from '@/supabase/supabase.module';
import { StudentAccountModule } from '@/student-account/student-account.module';
import { StudentPortalModule } from '@/student-portal/student-portal.module';
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
import { ReportFilesModule } from '@/report-files/report-files.module';
import { PermissionModule } from '@/permission/permission.module';
import { AnnouncementModule } from '@/announcement/announcement.module';
import { ImagesModule } from '@/images/images.module';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { RealtimeModule } from '@/realtime/realtime.module';
import { ChatModule } from '@/chat/chat.module';
import { QueueModule } from '@/queue/queue.module';
import { ScanModule } from '@/scan/scan.module';
import { CacheModule } from '@/cache/cache.module';
import { PaginationModule } from '@/pagination/pagination.module';
import { VersioningModule } from '@/versioning/versioning.module';
import { DashboardModule } from '@/dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: process.env.NODE_ENV === 'production' ? 10_000 : 100_000,
          getTracker: (req: ThrottlerReq) =>
            getSessionTracker(req) ?? `ip:${getClientIp(req) ?? 'unknown'}`,
        },
        {
          name: 'auth-strict',
          ttl: 60 * 60 * 1000,
          limit: process.env.NODE_ENV === 'production' ? 10_000 : 100_000,
          getTracker: (req: ThrottlerReq) =>
            req.body?.email?.toLowerCase() ?? getClientIp(req) ?? 'unknown',
        },
        {
          // Dedicated bucket for student claim-code redemption. It needs its
          // own name rather than a tight @Throttle on 'default': the storage
          // key is `${throttlerName}:${tracker}` with no route in it, so a
          // per-route override on 'default' shares one counter with every
          // other default-throttled route and trips on ordinary browsing.
          // Kept permissive here and tightened on the route, as auth-strict is.
          name: 'claim-code',
          ttl: 15 * 60 * 1000,
          limit: process.env.NODE_ENV === 'production' ? 10_000 : 100_000,
          getTracker: (req: ThrottlerReq) =>
            getSessionTracker(req) ?? `ip:${getClientIp(req) ?? 'unknown'}`,
        },
      ],

      // Every configured throttler increments on every request, so a bucket
      // shared across routes fills up during ordinary browsing and then trips
      // the tight per-route limits that are meant to guard one endpoint.
      // `default` stays global - it is the blunt per-tracker safety net - while
      // the purpose-built throttlers are scoped to the route they guard, which
      // is what `@Throttle({ 'auth-strict': ... })` on a single handler means.
      generateKey: (
        context: ExecutionContext,
        tracker: string,
        throttlerName: string,
      ) => {
        if (throttlerName === 'default') return `default:${tracker}`;
        const handler = context.getHandler?.()?.name ?? 'unknown';
        const controller = context.getClass?.()?.name ?? 'unknown';
        return `${throttlerName}:${controller}.${handler}:${tracker}`;
      },
    }),

    SupabaseModule,
    AuthModule,
    StudentAccountModule,
    StudentPortalModule,
    CacheModule,
    ScanModule,
    QueueModule.forRoot(),
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
    ReportFilesModule,
    PermissionModule,
    AnnouncementModule,
    ImagesModule,
    FileManagerModule,
    RealtimeModule,
    ChatModule,
    DashboardModule,
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
