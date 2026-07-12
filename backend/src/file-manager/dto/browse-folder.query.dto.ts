import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Browse one folder of the caller's own tree; omit `folderId` for the root. */
export class BrowseFolderQueryDto {
  @ApiPropertyOptional({ description: 'Folder to open; omit for the root.' })
  @IsOptional()
  @IsUUID()
  folderId?: string;
}
