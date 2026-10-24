# Announcement DTOs (`src/announcement/dto`)

These are the request bodies for creating and editing announcements. The school-wide controller and the course controller share them. They are validated by the global `ValidationPipe`, which rejects unknown fields. They carry no Swagger `@ApiProperty` decorators.

## Files

| File | Class | Used by | Validation |
|------|-------|---------|------------|
| `create-announcement.dto.ts` | `CreateAnnouncementDto` | `POST /api/announcements` and `POST /api/courses/:courseId/announcements` | `title`: required, non-empty string, at most 200 characters. `body`: optional string, at most 5000 characters; it is stored as `null` when left out. |
| `update-announcement.dto.ts` | `UpdateAnnouncementDto` | `PATCH /api/announcements/:id` and `PATCH /api/courses/:courseId/announcements/:id` | `title`: optional, but non-empty when given, at most 200 characters. `body`: optional, at most 5000 characters. Only the fields you send are changed, and `updated_at` is always set. |

## Adding a DTO

1. Add `<action>-announcement.dto.ts` with `class-validator` decorators on each field.
2. Use it as the `@Body()` type in `announcement.controller.ts` and/or `course-announcement.controller.ts`.
3. Handle the new fields in `announcement.service.ts`. The service builds the Prisma `data` object by hand, so a field that is not mapped there is silently dropped.
