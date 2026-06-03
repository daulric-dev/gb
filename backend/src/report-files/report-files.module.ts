import { Module } from '@nestjs/common';
import { ClassModule } from '@/class/class.module';
import { CalculationModule } from '@/calculation/calculation.module';
import { ReportingModule } from '@/reporting/reporting.module';
import { ReportFilesController } from './report-files.controller';
import { ReportFilesService } from './report-files.service';

@Module({
  imports: [CalculationModule, ClassModule, ReportingModule],
  controllers: [ReportFilesController],
  providers: [ReportFilesService],
})
export class ReportFilesModule {}
