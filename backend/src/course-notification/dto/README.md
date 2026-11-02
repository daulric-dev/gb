# Course notification DTOs (`src/course-notification/dto`)

Validation classes for the student notice routes, enforced by the global `ValidationPipe`.

## Files

`course-notification.dto.ts` defines both classes:

| Class | Route | Rules |
|-------|-------|-------|
| `ListCourseNotificationsQueryDto` | `QUERY /api/portal/me/notifications` (JSON body) | `limit`: optional integer 1-100 (converted with `@Type(() => Number)`; the service defaults to 30). `before`: optional ISO 8601 timestamp. `unread`: optional boolean; `true` (the strings `true` and `1` are also accepted). |
| `MarkCourseNotificationsReadDto` | `POST /api/portal/me/notifications/read` (body) | `ids`: array of at most 200 UUIDs. |

## How the parent uses them

`CourseNotificationController` passes the list query object straight to `CourseNotificationService.list` and `dto.ids` to `markRead`.

## Adding a new DTO

Add a class to `course-notification.dto.ts` (or a new `*.dto.ts` file) with `class-validator` rules and Swagger decorators. Query booleans and numbers arrive as strings, so add a `@Transform` or `@Type` as the existing classes do.

See the [course-notification README](../README.md).
