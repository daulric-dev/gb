# Calendar DTOs (`src/calendar/dto`)

Request validation classes for the calendar routes. They are applied by Nest's global `ValidationPipe`, so a value that fails a rule is rejected with `400` before the controller runs.

## Files

| File | Defines | Used by | Rules |
|------|---------|---------|-------|
| `calendar-range.query.dto.ts` | `CalendarRangeQueryDto` | Query string of all four routes: `GET /api/calendar`, `GET /api/calendar/ics`, `GET /api/portal/me/calendar`, `GET /api/portal/me/calendar/ics` | `from` and `to` are optional and must be ISO 8601 (`@IsISO8601`). `from` is inclusive, `to` exclusive. Defaults and the 400-day limit are applied in `CalendarService.range`, not here. |

## How the parent module uses it

`CalendarController` and `PortalCalendarController` take it with `@Query()` and pass `from` / `to` straight to `CalendarService.forStaff` / `forStudent`.

## Adding a new DTO

Create `<name>.dto.ts` here with a class decorated with `class-validator` rules and `@ApiProperty` / `@ApiPropertyOptional` for Swagger, then use it as the type of a `@Query()` or `@Body()` parameter in `calendar.controller.ts`. Keep range logic (defaults, limits) in the service so both controllers share it.

See the [calendar README](../README.md).
