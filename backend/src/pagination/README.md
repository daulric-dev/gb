# Pagination (`src/pagination`)

Shared types for paginated list endpoints: a query DTO and a result envelope. There is no module or service here. Endpoints that paginate do it themselves with Prisma `skip`/`take` (offset) or a `where` on the cursor column, and reuse these types for the query string and the response shape.

## What it provides

- **HTTP routes**: none.
- **Services / modules**: none.
- **Types** (`pagination.dto.ts`)
  - `PaginationQueryDto`: query-string DTO.

    | Field | Rules | Meaning |
    | --- | --- | --- |
    | `page` | optional int, min 1 | 1-based page number (offset mode) |
    | `pageSize` | optional int, 1 to 100 (default 20) | items per page |
    | `cursor` | optional string | cursor value (cursor mode; replaces `page`) |
    | `cursorColumn` | optional string (default `id`) | column the cursor is on; each endpoint checks it against its own allow-list (the student list answers 400 for an unknown one) |
    | `cursorDirection` | optional `asc` or `desc` (default `asc`) | sort direction for the cursor column |

  - `PaginatedResult<T>`: `{ data: T[]; meta: { total, page, pageSize, pageCount, nextCursor, hasMore } }`. `page` and `pageCount` are null in cursor mode; `nextCursor` is null in offset mode.

## Used by

- `src/student/dto/list-students.query.dto.ts` extends `PaginationQueryDto` for `GET /api/students`.
- `src/student/student.service.ts` and `src/student/transformer.ts` use `PaginationQueryDto` and `PaginatedResult` and implement both modes themselves with Prisma.
- `file-manager` returns a similar `{ data, meta }` envelope from `GET /api/files?page=` but defines it locally (no `nextCursor`).

## Depends on

Nothing besides `class-validator`, `class-transformer` and `@nestjs/swagger`.

## Data

None.

## Configuration

None.

## Files

| File | Purpose |
| --- | --- |
| `pagination.dto.ts` | `PaginationQueryDto` and `PaginatedResult<T>` |

## Tests

None in this folder. The student list's pagination is covered by the `student` tests (`bun test src/student`).

## See also

- [`docs/content/backend/student.md`](../../../docs/content/backend/student.md)
