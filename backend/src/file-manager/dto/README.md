# File manager DTOs (`src/file-manager/dto`)

Request bodies and query strings for `file-manager.controller.ts`. They are validated by the global `ValidationPipe`. The service then enforces what depends on data: ownership, folder existence, the school's upload limit, the allowed types and the byte checks.

| File | Defines | Used by | Validation |
| --- | --- | --- | --- |
| `list-files.query.dto.ts` | `ListFilesQueryDto` (re-exports `FileListFilter`) | `GET /api/files` | `filter`: optional `own`, `shared` or `all` (default `all`). `page`: optional int, at least 1. `pageSize`: optional int, 1 to 100. |
| `list-files.filter.ts` | `FileListFilter` enum | the DTO above, and `FileManagerService.list()` | Plain enum with no decorators, so the domain code can import it without class-validator |
| `browse-folder.query.dto.ts` | `BrowseFolderQueryDto` | `GET /api/files/folders/contents` | `folderId`: optional UUID; omit for the root |
| `create-folder.dto.ts` | `CreateFolderDto` | `POST /api/files/folders` | `name`: string, 1 to 120 characters. `parentId`: optional UUID. |
| `rename-folder.dto.ts` | `RenameFolderDto` | `PATCH /api/files/folders/:folderId` | `name`: string, 1 to 120 characters |
| `move-folder.dto.ts` | `MoveFolderDto` | `PATCH /api/files/folders/:folderId/move` | `parentId`: UUID, or `null` for the root |
| `rename-file.dto.ts` | `RenameFileDto` | `PATCH /api/files/:id` | `name`: non-empty, at most 255 |
| `move-file.dto.ts` | `MoveFileDto` | `PATCH /api/files/:id/move` | `folderId`: UUID, or `null` for the root |
| `share-file.dto.ts` | `ShareFileDto`, `ShareTargetDto`, `SharePrincipalType` | `POST /api/files/:id/shares` | `shares`: at least 1 target, validated as nested objects. Each target: `principalType` `user`, `role` or `course`; `principalId` a UUID (a `user_profile`, `school_role` or `course` id); `canDownload` an optional boolean (default view-only). |
| `update-share.dto.ts` | `UpdateShareDto` | `PATCH /api/files/:id/shares/:shareId` | `canDownload`: boolean |
| `upload-ticket.dto.ts` | `CreateUploadTicketDto` | `POST /api/files/upload-ticket`, and `src/student-portal/portal-activity.controller.ts` for student hand-ins | `name`: non-empty, at most 255. `sizeBytes`: int, 1 byte to 1000 MB (the DB range); the service then refuses anything above the school's upload limit. `contentType`: non-empty, at most 255. `folderId`: optional UUID. Every field is checked again against the stored bytes on completion. |

## Adding a DTO

Create `<name>.dto.ts` with class-validator rules (and `@ApiProperty` for Swagger), then use it as the `@Body()` or `@Query()` type in the controller. If the domain service needs a type from it, put that type in a decorator-free file the way `list-files.filter.ts` does.
