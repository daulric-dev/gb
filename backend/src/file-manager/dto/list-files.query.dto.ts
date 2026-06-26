import { IsEnum, IsOptional } from 'class-validator';

export enum FileListFilter {
  /** Files the caller owns. */
  Own = 'own',
  /** Files shared with the caller (directly, by role, or by group). */
  Shared = 'shared',
  /** Both of the above. */
  All = 'all',
}

export class ListFilesQueryDto {
  @IsOptional()
  @IsEnum(FileListFilter)
  filter?: FileListFilter = FileListFilter.All;
}
