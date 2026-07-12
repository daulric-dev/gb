import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/** Move a file into a folder, or to the root with `folderId: null`. */
export class MoveFileDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Destination folder id, or null for the root of My files.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsUUID()
  folderId!: string | null;
}
