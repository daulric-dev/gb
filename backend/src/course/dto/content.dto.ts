import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MODULE_ITEM_TYPES = [
  'page',
  'activity',
  'file',
  'link',
  'header',
  'discussion',
] as const;
export type ModuleItemType = (typeof MODULE_ITEM_TYPES)[number];

// ── modules ─────────────────────────────────────────────────────────────────

export class CreateModuleDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
}

export class UpdateModuleDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  isPublished?: boolean;
}

export class ReorderModulesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  moduleIds!: string[];
}

// ── module items ────────────────────────────────────────────────────────────

export class CreateModuleItemDto {
  @ApiProperty({ enum: MODULE_ITEM_TYPES })
  @IsIn(MODULE_ITEM_TYPES)
  itemType!: ModuleItemType;

  /** Required for links and headers; optional override for the rest. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() pageId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() activityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() discussionTopicId?: string;

  // Only http(s): a module link is clicked by students, so no javascript: or
  // data: URLs.
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  indent?: number;
}

export class UpdateModuleItemDto {
  /** null clears an override so the item shows its target's name again. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 3 })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(3)
  indent?: number;

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  isPublished?: boolean;

  /** Move the item to another module of the same course (appended last). */
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  moduleId?: string;
}

export class ReorderModuleItemsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  itemIds!: string[];
}

// ── pages ───────────────────────────────────────────────────────────────────

export class CreatePageDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  body?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdatePageDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(100_000)
  body?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  isPublished?: boolean;
}
