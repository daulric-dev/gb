import { Module, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { VersioningGuard } from '@/versioning/versioning.guard';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: process.env.NODE_ENV === 'production' ? 100 : 1000,
        },
        {
          name: 'auth-strict',
          ttl: 60 * 60 * 1000,
          limit: process.env.NODE_ENV === 'production' ? 5 : 100,
          getTracker: (req: { body?: { email?: string }; ip?: string }) =>
            req.body?.email?.toLowerCase() ?? req.ip ?? 'unknown',
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
