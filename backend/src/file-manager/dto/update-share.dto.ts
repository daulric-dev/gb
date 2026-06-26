import { IsBoolean } from 'class-validator';

export class UpdateShareDto {
  /** Toggle whether this recipient may download (vs. view-only). */
  @IsBoolean()
  canDownload!: boolean;
}
