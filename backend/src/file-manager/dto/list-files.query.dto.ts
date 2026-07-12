import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { FileListFilter } from './list-files.filter';

export { FileListFilter };

export class ListFilesQueryDto {
  @IsOptional()
  @IsEnum(FileListFilter)
  filter?: FileListFilter = FileListFilter.All;

  /**
   * 1-based page number. When omitted the endpoint returns the full array
   * (backward-compatible); when present it returns a paginated envelope.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Items per page (offset mode). Defaults to 20, capped at 100. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
