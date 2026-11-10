import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { RequireFeature } from '@/features/require-feature.decorator';
import { LibraryService } from './library.service';
import { LibraryImportService } from './library-import.service';
import {
  ImportLibraryItemDto,
  LibraryBrowseQueryDto,
  LibraryVersionQueryDto,
  PublishLibraryItemDto,
  RepublishLibraryItemDto,
  UpdateLibraryItemDto,
} from './library.dto';

/**
 * The course template library (`course_copy` feature). Every rule is in the
 * services: staff of the caller's active school only; publishing needs a
 * manage role on the source course, organisation-wide sharing
 * `course-library:create`; importing needs a manage role on the target or
 * `course:create` for a new course.
 */
@ApiTags('Course library')
@ApiBearerAuth()
@Controller('library')
@UseGuards(AuthGuard, FeatureGuard)
@RequireFeature('course_copy')
export class LibraryController {
  constructor(
    private readonly library: LibraryService,
    private readonly imports: LibraryImportService,
  ) {}

  @Get('items')
  browse(@Req() req: any, @Query() q: LibraryBrowseQueryDto) {
    return this.library.browse(req.user.id as string, q);
  }

  @Post('items')
  publish(@Req() req: any, @Body() dto: PublishLibraryItemDto) {
    return this.library.publish(req.user.id as string, dto);
  }

  @Get('items/:itemId')
  get(
    @Req() req: any,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() q: LibraryVersionQueryDto,
  ) {
    return this.library.get(req.user.id as string, itemId, q.version);
  }

  @Patch('items/:itemId')
  update(
    @Req() req: any,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateLibraryItemDto,
  ) {
    return this.library.update(req.user.id as string, itemId, dto);
  }

  @Post('items/:itemId/versions')
  republish(
    @Req() req: any,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: RepublishLibraryItemDto,
  ) {
    return this.library.republish(req.user.id as string, itemId, dto);
  }

  @Post('items/:itemId/unpublish')
  @HttpCode(200)
  unpublish(@Req() req: any, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.library.unpublish(req.user.id as string, itemId);
  }

  @Post('items/:itemId/import')
  @HttpCode(202)
  importItem(
    @Req() req: any,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ImportLibraryItemDto,
  ) {
    return this.imports.start(req.user.id as string, itemId, dto);
  }

  @Get('imports')
  myImports(@Req() req: any) {
    return this.imports.listMine(req.user.id as string);
  }

  @Get('imports/:importId')
  importStatus(@Req() req: any, @Param('importId', ParseUUIDPipe) importId: string) {
    return this.imports.status(req.user.id as string, importId);
  }
}
