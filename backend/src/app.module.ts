import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { SupabaseModule } from '@/supabase/supabase.module';
import { AuthModule } from '@/auth/auth.module';
import { ClassModule } from '@/class/class.module';
import { AcademicYearModule } from '@/academic-year/academic-year.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    AuthModule,
    ClassModule,
    AcademicYearModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})

export class AppModule {}