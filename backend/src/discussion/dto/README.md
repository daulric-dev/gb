# Discussion DTOs (`src/discussion/dto`)

All request bodies for the discussion routes live in `discussion.dto.ts`. They are validated by the global `ValidationPipe`. Permission rules (who may set which flag) are enforced in `DiscussionService`, not here.

## Classes

| Class | Routes | Rules |
|-------|--------|-------|
| `CreateTopicDto` | `POST /api/courses/:courseId/discussions`, `POST /api/portal/me/courses/:courseId/discussions` | `title`: required, non-empty, max 200. `body`: optional Markdown, max 20000. Optional booleans `isPinned`, `isLocked`, `isPublished`, `requireInitialPost` (staff only; ignored for students). |
| `UpdateTopicDto` | `PATCH .../discussions/:topicId` (staff and portal) | Same fields as `CreateTopicDto`, all optional. Sending none is a `400 Nothing to update`; a student sending any flag gets `403`. |
| `CreateReplyDto` | `POST .../discussions/:topicId/replies` (staff and portal) | `body`: required Markdown, non-empty, max 10000. `parentId`: optional UUID of the reply being answered. |
| `UpdateReplyDto` | `PATCH .../discussions/:topicId/replies/:replyId` (staff and portal) | `body`: required, non-empty, max 10000. |
| `UpdateDiscussionSettingsDto` | `PUT /api/courses/:courseId/discussions/settings` | `studentsCanCreateTopics`: required boolean. |

Titles and reply bodies are also trimmed in the service; an all-whitespace value is rejected there.

## Adding a field or DTO

Add the property with `class-validator` and `@ApiProperty` / `@ApiPropertyOptional` decorators, then map it in the matching `DiscussionService` method (and its Prisma `select`) and decide in the service whether students may set it.

See the [discussion README](../README.md).
