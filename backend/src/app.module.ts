import { Module, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { GradingModule } from '@/grading/grading.module';
import { CalculationModule } from '@/calculation/calculation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: 100,
        },
      ],
      // One shared bucket per client (IP); default keys per controller method.
      generateKey: (
        _context: ExecutionContext,
        tracker: string,
        throttlerName: string,
      ) => `${throttlerName}:${tracker}`,
    }),
    SupabaseModule,
    AuthModule,
    ClassModule,
    AcademicYearModule,
    SchoolModule,
    StudentModule,
    SubjectModule,
    TermModule,
    EnrollmentModule,
    GradingModule,
    CalculationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
