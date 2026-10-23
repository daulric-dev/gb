import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '@/pagination/pagination.dto';

/**
 * The roster query: paging plus a name search. One DTO for the whole query
 * string - validating `search` and the paging fields separately made the
 * paging DTO reject `search` as an unknown property.
 */
export class ListStudentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches first or last name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
