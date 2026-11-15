import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { AI_BATCH_MAX_SUBMISSIONS } from './file-grading.constants';

export class FileGradingDraftDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() studentId!: string;
}

export class StartBatchDto {
  /** The number of submissions the confirmation showed; a different number now is a 409. */
  @ApiProperty() @IsInt() @Min(1) @Max(AI_BATCH_MAX_SUBMISSIONS) expectedSubmissions!: number;
}
