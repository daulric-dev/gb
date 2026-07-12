import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { FileManagerService } from './file-manager.service';
import { FileNotificationService } from './file-notification.service';
import { FolderService } from './folder.service';
import { ListFilesQueryDto } from './dto/list-files.query.dto';
import { RenameFileDto } from './dto/rename-file.dto';
import { ShareFileDto } from './dto/share-file.dto';
import { UpdateShareDto } from './dto/update-share.dto';
import { CreateFolderDto } from './dto/create-folder.dto';
import { RenameFolderDto } from './dto/rename-folder.dto';
import { MoveFileDto } from './dto/move-file.dto';
import { BrowseFolderQueryDto } from './dto/browse-folder.query.dto';

@ApiTags('File Manager')
@ApiBearerAuth()
@Controller('files')
@UseGuards(AuthGuard, PermissionGuard)
export class FileManagerController {
  constructor(
    private readonly files: FileManagerService,
    private readonly notifications: FileNotificationService,
    private readonly folders: FolderService,
  ) {}

  @RequirePermission('file', 'read')
  @Get()
  async list(@Req() req: any, @Query() query: ListFilesQueryDto) {
    return this.files.list(req.user.id, query.filter, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @RequirePermission('file', 'create')
  @Post()
  @ApiConsumes('multipart/form-data')
  async upload(
    @Req() req: any,
    @Query('name') name?: string,
    @Query('folderId') folderId?: string,
  ) {
    const file = await req.file();
    return this.files.uploadManual(req.user.id, file, name, folderId);
  }

  // ── Folders (declared before :id so the literal path wins) ────────────────

  @RequirePermission('file', 'read')
  @Get('folders/contents')
  async browseFolder(@Req() req: any, @Query() query: BrowseFolderQueryDto) {
    return this.files.browseFolder(req.user.id, query.folderId ?? null);
  }

  @RequirePermission('file', 'read')
  @Get('folders')
  async listFolders(@Req() req: any) {
    return this.folders.listAll(req.user.id);
  }

  @RequirePermission('file', 'create')
  @Post('folders')
  async createFolder(@Req() req: any, @Body() dto: CreateFolderDto) {
    return this.folders.create(req.user.id, dto.name, dto.parentId ?? null);
  }

  @RequirePermission('file', 'update')
  @Patch('folders/:folderId')
  async renameFolder(
    @Req() req: any,
    @Param('folderId') folderId: string,
    @Body() dto: RenameFolderDto,
  ) {
    return this.folders.rename(req.user.id, folderId, dto.name);
  }

  @RequirePermission('file', 'delete')
  @Delete('folders/:folderId')
  async deleteFolder(@Req() req: any, @Param('folderId') folderId: string) {
    return this.folders.remove(req.user.id, folderId);
  }

  // ── Notifications (declared before :id so the literal path wins) ──────────

  @RequirePermission('file', 'read')
  @Get('notifications')
  async listNotifications(@Req() req: any) {
    return this.notifications.list(req.user.id);
  }

  @RequirePermission('file', 'read')
  @Get('notifications/unread-count')
  async unreadNotifications(@Req() req: any) {
    return this.notifications.unreadCount(req.user.id);
  }

  @RequirePermission('file', 'read')
  @Post('notifications/mark-read')
  async markNotificationsRead(@Req() req: any) {
    return this.notifications.markAllRead(req.user.id);
  }

  @RequirePermission('file', 'read')
  @Get(':id')
  async metadata(@Req() req: any, @Param('id') id: string) {
    return this.files.getMetadata(req.user.id, id);
  }

  @RequirePermission('file', 'read')
  @Get(':id/content')
  async view(
    @Req() req: any,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, contentType, filename } = await this.files.getViewContent(
      req.user.id,
      id,
    );
    reply
      .header('Content-Type', contentType)
      .header(
        'Content-Disposition',
        `inline; filename="${this.encode(filename)}"`,
      )
      .header('Content-Length', buffer.length)
      .header('Cache-Control', 'private, no-store')
      .send(buffer);
  }

  /** Download — only for the owner or a recipient with download rights. */
  @RequirePermission('file', 'read')
  @Get(':id/download')
  async download(
    @Req() req: any,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, contentType, filename } =
      await this.files.getDownloadContent(req.user.id, id);
    reply
      .header('Content-Type', contentType)
      .header(
        'Content-Disposition',
        `attachment; filename="${this.encode(filename)}"`,
      )
      .header('Content-Length', buffer.length)
      .header('Cache-Control', 'private, no-store')
      .send(buffer);
  }

  @RequirePermission('file', 'update')
  @Patch(':id')
  async rename(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: RenameFileDto,
  ) {
    return this.files.rename(req.user.id, id, dto.name);
  }

  /** Move a file into a folder (or to the root with `folderId: null`). */
  @RequirePermission('file', 'update')
  @Patch(':id/move')
  async move(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: MoveFileDto,
  ) {
    return this.files.move(req.user.id, id, dto.folderId);
  }

  @RequirePermission('file', 'delete')
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.files.softDelete(req.user.id, id);
  }

  // ── Shares (owner only; ownership enforced in the service) ─────────────────

  @RequirePermission('file', 'update')
  @Get(':id/shares')
  async listShares(@Req() req: any, @Param('id') id: string) {
    return this.files.listShares(req.user.id, id);
  }

  @RequirePermission('file', 'update')
  @Post(':id/shares')
  async share(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ShareFileDto,
  ) {
    return this.files.share(req.user.id, id, dto.shares);
  }

  @RequirePermission('file', 'update')
  @Patch(':id/shares/:shareId')
  async updateShare(
    @Req() req: any,
    @Param('id') id: string,
    @Param('shareId') shareId: string,
    @Body() dto: UpdateShareDto,
  ) {
    return this.files.updateShare(req.user.id, id, shareId, dto.canDownload);
  }

  @RequirePermission('file', 'update')
  @Delete(':id/shares/:shareId')
  async revokeShare(
    @Req() req: any,
    @Param('id') id: string,
    @Param('shareId') shareId: string,
  ) {
    return this.files.revokeShare(req.user.id, id, shareId);
  }

  /** RFC 5987-safe filename for the Content-Disposition header. */
  private encode(name: string): string {
    return name.replace(/["\\\r\n]/g, '_');
  }
}
