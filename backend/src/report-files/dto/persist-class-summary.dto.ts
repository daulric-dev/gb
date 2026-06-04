import { IsIn, IsUUID } from 'class-validator';

export class PersistClassSummaryDto {
  @IsUUID()
  studentGroupId!: string;

  @IsUUID()
  termId!: string;

  @IsIn(['term', 'year_end'])
  reportType!: string;
}
