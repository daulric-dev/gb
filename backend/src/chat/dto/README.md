# Chat DTOs (`src/chat/dto`)

Request body and query classes for the chat routes. Nest's global `ValidationPipe` enforces the `class-validator` rules, so invalid input is a `400` before `ChatController` runs. Conversation and message ids in the URL are not DTO-validated; `ChatService` treats a malformed id as "not found".

## Files

| File | Class | Route | Key rules |
|------|-------|-------|-----------|
| `create-conversation.dto.ts` | `CreateConversationDto` | `POST /api/chat/conversations` | `userId`: UUID of the other user. |
| `create-channel.dto.ts` | `CreateChannelDto` | `POST /api/chat/channels` | `title`: string, 1-120 chars. `memberIds`: non-empty array of at most 200 UUIDs. Only works with `CHAT_CHANNELS_ENABLED=true`. |
| `send-message.dto.ts` | `SendMessageDto` | `POST /api/chat/conversations/:id/messages` and `PATCH /api/chat/messages/:id` | `body`: string, 1-4000 chars. |
| `list-messages.query.dto.ts` | `ListMessagesQueryDto` | `GET /api/chat/conversations/:id/messages` (query) | `before`: optional ISO 8601 timestamp (messages strictly before it). `limit`: optional integer 1-100, converted from the query string with `@Type(() => Number)`; the service defaults it to 30. |
| `message-action.dto.ts` | `MessageActionDto` | `POST /api/chat/messages/:id/action` | `action`: `accept` or `dismiss`; the controller maps it to the `accepted` / `dismissed` action state. |

## Adding a new DTO

Add `<verb>-<noun>.dto.ts` with a class using `class-validator` decorators and `@ApiProperty` for Swagger. Numeric query parameters need `@Type(() => Number)` from `class-transformer`. Reference it with `@Body()` or `@Query()` in `chat.controller.ts`; keep authorization (membership, ownership, same school) in `ChatService`.

See the [chat README](../README.md).
