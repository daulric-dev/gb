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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { SupabaseService } from '@/supabase/supabase.service';
import { PresenceService } from '@/realtime/presence.service';
import { ChatService } from './chat.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageActionDto } from './dto/message-action.dto';
import { ListMessagesQueryDto } from './dto/list-messages.query.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import type { ChatEvent } from './chat.types';

const SSE_HEARTBEAT_MS = 25_000;

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
@UseGuards(AuthGuard, PermissionGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly realtime: ChatRealtimeService,
    private readonly presence: PresenceService,
    private readonly supabase: SupabaseService,
  ) {}

  @RequirePermission('chat', 'read')
  @Get('stream')
  async stream(@Req() req: any, @Res() reply: FastifyReply): Promise<void> {
    const userId = req.user.id;
    let schoolId: string | null = null;
    try {
      schoolId = await this.supabase.getUserSchoolId(userId);
    } catch {
      schoolId = null;
    }

    reply.hijack();
    const raw = reply.raw;
    const origin = req.headers?.origin;
    const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    });
    // Ask the browser to reconnect ~5s after a drop, and open the stream.
    raw.write('retry: 5000\n\n');

    const send = (event: ChatEvent) => {
      raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    const unsubscribe = await this.realtime.subscribeUser(userId, send);

    // Presence: mark the user online, relay the school's online/offline events,
    // and keep the user fresh on each heartbeat.
    let unsubPresence: (() => void) | null = null;
    if (schoolId) {
      unsubPresence = await this.presence.subscribeSchool(schoolId, (e) =>
        send(e as unknown as ChatEvent),
      );
      await this.presence.connect(userId, schoolId);
    }

    const heartbeat = setInterval(() => {
      raw.write(': ping\n\n');
      if (schoolId) void this.presence.heartbeat(userId, schoolId);
    }, SSE_HEARTBEAT_MS);

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      unsubPresence?.();
      if (schoolId) void this.presence.disconnect(userId, schoolId);
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  }

  /** User ids currently online in the caller's school. */
  @RequirePermission('chat', 'read')
  @Get('presence')
  async presenceList(@Req() req: any): Promise<{ online: string[] }> {
    let schoolId: string;
    try {
      schoolId = await this.supabase.getUserSchoolId(req.user.id);
    } catch {
      return { online: [] };
    }
    return { online: await this.presence.onlineUserIds(schoolId) };
  }

  // ── Directory / counters ────────────────────────────────────────────────────

  @RequirePermission('chat', 'read')
  @Get('users')
  async users(@Req() req: any) {
    return this.chat.listMessageableUsers(req.user.id);
  }

  @RequirePermission('chat', 'read')
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    return this.chat.totalUnread(req.user.id);
  }

  // ── Conversations ────────────────────────────────────────────────────────────

  @RequirePermission('chat', 'read')
  @Get('conversations')
  async listConversations(@Req() req: any) {
    return this.chat.listConversations(req.user.id);
  }

  @RequirePermission('chat', 'create')
  @Post('conversations')
  async createConversation(
    @Req() req: any,
    @Body() dto: CreateConversationDto,
  ) {
    return this.chat.getOrCreateDirect(req.user.id, dto.userId);
  }

  @RequirePermission('chat', 'create')
  @Post('channels')
  async createChannel(@Req() req: any, @Body() dto: CreateChannelDto) {
    return this.chat.createChannel(req.user.id, dto.title, dto.memberIds);
  }

  @RequirePermission('chat', 'read')
  @Get('conversations/:id/messages')
  async listMessages(
    @Req() req: any,
    @Param('id') id: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.chat.listMessages(req.user.id, id, {
      before: query.before,
      limit: query.limit,
    });
  }

  @RequirePermission('chat', 'create')
  @Post('conversations/:id/messages')
  async sendMessage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.sendMessage(req.user.id, id, dto.body);
  }

  @RequirePermission('chat', 'update')
  @Post('conversations/:id/read')
  async markRead(@Req() req: any, @Param('id') id: string) {
    return this.chat.markRead(req.user.id, id);
  }

  // ── Messages ─────────────────────────────────────────────────────────────────

  @RequirePermission('chat', 'update')
  @Patch('messages/:id')
  async editMessage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.editMessage(req.user.id, id, dto.body);
  }

  @RequirePermission('chat', 'delete')
  @Delete('messages/:id')
  async deleteMessage(@Req() req: any, @Param('id') id: string) {
    return this.chat.deleteMessage(req.user.id, id);
  }

  @RequirePermission('chat', 'update')
  @Post('messages/:id/action')
  async act(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: MessageActionDto,
  ) {
    const state = dto.action === 'accept' ? 'accepted' : 'dismissed';
    return this.chat.setActionState(req.user.id, id, state);
  }
}
