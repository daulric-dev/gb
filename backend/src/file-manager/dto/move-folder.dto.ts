import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/** Re-parent a folder, or move it to the root with `parentId: null`. */
export class MoveFolderDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Destination parent folder id, or null for the root.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsUUID()
  parentId!: string | null;
}
