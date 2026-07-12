import { Global, Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSystemService } from './chat-system.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { MessageCipher } from './message-cipher.service';

@Global()
@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatSystemService,
    ChatRealtimeService,
    MessageCipher,
  ],
  exports: [ChatService, ChatSystemService],
})
export class ChatModule {}
