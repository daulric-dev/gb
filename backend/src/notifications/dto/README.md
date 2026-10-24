# Notifications DTOs (`src/notifications/dto`)

Request bodies for the push-device routes in `notifications.controller.ts`. They are validated by the global `ValidationPipe`.

| File | Defines | Used by | Validation |
| --- | --- | --- | --- |
| `push-device.dto.ts` | `RegisterPushDeviceDto`, `PUSH_PLATFORMS` | `POST /api/notifications/devices` | `token`: non-empty string, at most 255 characters. `platform`: one of `ios`, `android`, `web`. |

`DELETE /api/notifications/devices/:token` takes the token from the path and has no DTO.

`RegisterPushDeviceDto.platform` is typed as `PushPlatform` from `../push.service`, so a new platform has to be added in two places: `PUSH_PLATFORMS` here and the `PushPlatform` type in `push.service.ts`.

## Adding a DTO

Create `<name>.dto.ts` with a class-validator class and `@ApiProperty` decorators for Swagger, then use it as the `@Body()` type in `notifications.controller.ts`.
