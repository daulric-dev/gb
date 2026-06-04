import { Module } from '@nestjs/common';
import { ClassModule } from '@/class/class.module';
import { CalculationModule } from '@/calculation/calculation.module';
import { ReportController, ReportEntriesController } from './report.controller';
import { ReportService } from './report.service';
import { ReportGuard } from './report.guard';

@Module({
  imports: [CalculationModule, ClassModule],
  controllers: [ReportController, ReportEntriesController],
  providers: [ReportService, ReportGuard],
  exports: [ReportGuard],
})
export class ReportingModule {}
