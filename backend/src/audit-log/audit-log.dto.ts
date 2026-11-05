import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListAuditLogDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsUUID()
  before?: string;
}
