import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
  providers: [AppService],
})
export class AppModule {}
