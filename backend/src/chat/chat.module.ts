import { Global, Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSystemService } from './chat-system.service';
import { ChatRealtimeService } from './chat-realtime.service';

/**
 * Global so other features (file manager, classes) can inject
 * ChatSystemService to emit system messages without importing this module.
 */
@Global()
@Module({
  controllers: [ChatController],
  providers: [ChatService, ChatSystemService, ChatRealtimeService],
  exports: [ChatService, ChatSystemService],
})
export class ChatModule {}
