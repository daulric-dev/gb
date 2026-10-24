# Images DTOs (`src/images/dto`)

Request bodies for the direct (presigned PUT) avatar upload. The routes that use them are declared in `src/auth/auth.controller.ts` and call `ImagesService`.

| File | Defines | Used by | Validation |
| --- | --- | --- | --- |
| `create-resumable-upload.dto.ts` | `CreateResumableUploadDto` | `POST /api/auth/avatar/resumable` | `filename`: non-empty string. `contentType`: non-empty string. `totalSize`: number, at least 1. |
| `complete-upload.dto.ts` | `CompleteUploadDto` | `POST /api/auth/avatar/complete` | `path`: non-empty string (e.g. `avatars/<userId>.png`) |

These DTOs only reject obviously bad input. The real limits live in `ImagesService`, which enforces them again against the stored bytes: 5 MB, JPEG, PNG or WebP only, a matching byte signature, and a path that must be the caller's own.

## Adding a DTO

Create `<name>.dto.ts` with class-validator rules and `@ApiProperty` decorators. Import it in the controller that declares the route (today that is `auth.controller.ts`, not `images.controller.ts`).
