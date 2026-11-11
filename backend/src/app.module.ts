import { Module, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { getClientIp, getEmailIpTracker, getSessionTracker, skipUnlessDeclared, type ThrottlerReq } from '@/throttle/tracker';
import type { RedisThrottlerStorage } from '@/throttle/redis-throttler.storage';
import { THROTTLER_SHARED_STORAGE, ThrottleStorageModule } from '@/throttle/throttle-storage.module';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { VersioningGuard } from '@/versioning/versioning.guard';
import { PrismaModule } from '@/prisma/prisma.module';
import { StorageModule } from '@/storage/storage.module';
import { MailModule } from '@/mail/mail.module';
import { AccountModule } from '@/account/account.module';
import { StudentAccountModule } from '@/student-account/student-account.module';
import { StudentPortalModule } from '@/student-portal/student-portal.module';
import { AuthModule } from '@/auth/auth.module';
import { AcademicYearModule } from '@/academic-year/academic-year.module';
import { SchoolModule } from '@/school/school.module';
import { StudentModule } from '@/student/student.module';
import { TermModule } from '@/term/term.module';
import { GradingModule } from '@/grading/grading.module';
import { SubmissionEventsModule } from '@/grading/submission-events';
import { PeerReviewModule } from '@/peer-review/peer-review.module';
import { SimilarityModule } from '@/similarity/similarity.module';
import { AiModule } from '@/ai/ai.module';
import { TranslationModule } from '@/translation/translation.module';
import { GradeScaleModule } from '@/grade-scale/grade-scale.module';
import { PermissionModule } from '@/permission/permission.module';
import { AnnouncementModule } from '@/announcement/announcement.module';
import { ImagesModule } from '@/images/images.module';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { RealtimeModule } from '@/realtime/realtime.module';
import { ChatModule } from '@/chat/chat.module';
import { QueueModule } from '@/queue/queue.module';
import { CacheModule } from '@/cache/cache.module';
import { VersioningModule } from '@/versioning/versioning.module';
import { DashboardModule } from '@/dashboard/dashboard.module';
import { CourseAccessModule } from '@/course/access/course-access.module';
import { CourseModule } from '@/course/course.module';
import { CourseLibraryModule } from '@/course/library/library.module';
import { PastoralModule } from '@/pastoral/pastoral.module';
import { SsoCoreModule } from '@/sso/sso-core.module';
import { SsoModule } from '@/sso/sso.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { AttendanceModule } from '@/attendance/attendance.module';
import { TimetableModule } from '@/timetable/timetable.module';
import { AttendanceAlertsModule } from '@/attendance-alerts/attendance-alerts.module';
import { AnalyticsModule } from '@/analytics/analytics.module';
import { DiscussionModule } from '@/discussion/discussion.module';
import { CalendarModule } from '@/calendar/calendar.module';
import { CourseNotificationModule } from '@/course-notification/course-notification.module';
import { OrganisationModule } from '@/organisation/organisation.module';
import { FeaturesModule } from '@/features/features.module';
import { ErasureModule } from '@/erasure/erasure.module';
import { RetentionModule } from '@/retention/retention.module';
import { AppVersionModule } from '@/app-version/app-version.module';
import { IntegrationsModule } from '@/integrations/integrations.module';
import { AuditLogModule } from '@/audit-log/audit-log.module';
import { ReportCardModule } from '@/report-card/report-card.module';
import { ParentPortalModule } from '@/parent-portal/parent-portal.module';
import { LtiModule } from '@/lti/lti.module';
import { RosteringModule } from '@/rostering/rostering.module';
import { MasteryModule } from '@/mastery/mastery.module';
import { DataExportModule } from '@/data-export/data-export.module';
import { StudentRestrictionModule } from '@/student-restriction/student-restriction.module';
import { PrivacyModule } from '@/privacy/privacy.module';
import { MfaModule } from '@/mfa/mfa.module';
import { HealthService } from '@/health/health.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      // Shared Redis counters when USE_REDIS=true, so limits hold across
      // replicas; undefined keeps the library's in-memory storage.
      imports: [ThrottleStorageModule],
      inject: [THROTTLER_SHARED_STORAGE],
      useFactory: (storage?: RedisThrottlerStorage) => ({
        storage,
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: process.env.NODE_ENV === 'production' ? 1_200 : 100_000,
            getTracker: (req: ThrottlerReq) =>
              getSessionTracker(req) ?? `ip:${getClientIp(req) ?? 'unknown'}`,
          },
          {
            // Sign-in routes only (see skipUnlessDeclared), per address + IP.
            name: 'auth-strict',
            ttl: 60 * 60 * 1000,
            limit: process.env.NODE_ENV === 'production' ? 10_000 : 100_000,
            getTracker: getEmailIpTracker,
            skipIf: skipUnlessDeclared('auth-strict'),
          },
          {
            name: 'auth-ip',
            ttl: 60 * 60 * 1000,
            limit: process.env.NODE_ENV === 'production' ? 10_000 : 100_000,
            getTracker: (req: ThrottlerReq) =>
              `ip:${getClientIp(req) ?? 'unknown'}`,
            skipIf: skipUnlessDeclared('auth-ip'),
          },
          {
            // Per-route limits (account deletion, connection tests, signed
            // links, LTI tokens). Only applies where a route declares it in
            // @Throttle({ route: ... }); its counter is per route (see
            // generateKey), unlike 'default', which is one counter per
            // session across every route - overriding 'default' on one route
            // would compare that route's limit against everything the
            // session has called.
            name: 'route',
            ttl: 60_000,
            limit: 100_000,
            getTracker: (req: ThrottlerReq) =>
              getSessionTracker(req) ?? `ip:${getClientIp(req) ?? 'unknown'}`,
            skipIf: skipUnlessDeclared('route'),
          },
          {
            name: 'claim-code',
            ttl: 15 * 60 * 1000,
            limit: process.env.NODE_ENV === 'production' ? 10_000 : 100_000,
            getTracker: (req: ThrottlerReq) =>
              getSessionTracker(req) ?? `ip:${getClientIp(req) ?? 'unknown'}`,
          },
        ],

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
    }),

    PrismaModule,
    FeaturesModule,
    StorageModule,
    MailModule,
    AccountModule,
    MfaModule,
    AuthModule,
    StudentAccountModule,
    StudentPortalModule,
    CacheModule,
    QueueModule.forRoot(),
    VersioningModule,
    CourseAccessModule,
    CourseModule,
    CourseLibraryModule.forRoot(),
    PastoralModule,
    SsoCoreModule,
    SsoModule,

    AcademicYearModule,
    SchoolModule,
    StudentModule,
    TermModule,
    GradingModule,
    SubmissionEventsModule,
    PeerReviewModule,
    SimilarityModule.forRoot(),
    AiModule,
    TranslationModule,
    GradeScaleModule,
    PermissionModule,
    AnnouncementModule,
    ImagesModule,
    FileManagerModule,
    RealtimeModule,
    ChatModule,
    DashboardModule,
    NotificationsModule,
    AttendanceModule,
    TimetableModule,
    AttendanceAlertsModule,
    AnalyticsModule,
    ParentPortalModule,
    DiscussionModule,
    CalendarModule,
    CourseNotificationModule,
    OrganisationModule,
    ErasureModule,
    RetentionModule,
    AppVersionModule,
    IntegrationsModule.forRoot(),
    AuditLogModule,
    LtiModule,
    ReportCardModule.forRoot(),
    DataExportModule.forRoot(),
    RosteringModule.forRoot(),
    MasteryModule,
    StudentRestrictionModule,
    PrivacyModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    HealthService,
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
