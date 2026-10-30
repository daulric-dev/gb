# Storage (`src/storage`)

Object storage for uploaded and generated files, on any S3-compatible store: AWS S3, Cloudflare R2, Backblaze B2, or SeaweedFS in local development (the `s3` service in `docker-compose.dev.yml`).

Everything lives in **one bucket** (`S3_BUCKET`). Database rows still store a `(bucket, storage_path)` pair from when each area had its own bucket; `objectKey(bucket, path)` joins the two into the real key `<bucket>/<path>`, so the old bucket name becomes a key prefix (`file-manager/...`, `images/...`). That function is the one place the mapping lives.

Browsers and phones upload and download directly against the store using **presigned URLs**, so file bytes do not have to pass through the API. When the address the API uses to reach the store differs from the one clients use (the API in a container, a phone on the LAN), `S3_PUBLIC_ENDPOINT` makes the presigned URLs carry the client-facing host.

## What it provides

- **HTTP routes** - none.
- **Services / exports** - `StorageModule` is `@Global()` and exports `StorageService`:
  - `bucket` - the configured bucket name.
  - `put(key, body, contentType?)` - upload bytes.
  - `get(key)` - `{ body: Readable, contentType, size }`, or null if the key does not exist.
  - `getBuffer(key, maxBytes = 64 MB)` - the whole object as a `Buffer`, or null. The body is counted as it streams and abandoned past `maxBytes` (`ObjectTooLargeError`); the HEAD size is never trusted.
  - `exists(key)` - `{ size, contentType }` from a HEAD request, or null.
  - `copy(fromKey, toKey, contentType)` - server-side copy inside the bucket (`CopyObject`, `MetadataDirective: REPLACE`), so the bytes never pass through the API. The content type is set afresh.
  - `delete(key | keys[])` - delete one key, or many in batches of 1000.
  - `listKeys(prefix, { endBefore? })` - every key under a prefix, ascending (paginated `ListObjectsV2`). Used by the erasure log (its storage copy, pruning) and account-deletion clean-up.
  - `downloadUrl(key, { expiresIn = 300, filename?, inline? })` - presigned GET, optionally with a `Content-Disposition` (attachment by default, `inline` on request).
  - `uploadUrl(key, contentType, expiresIn = 300, contentLength?)` - presigned PUT. The content type (and the length, when given) is signed, so the client must send exactly that `Content-Type` and that many bytes. Upload keys live under `<area>/uploads/` (`UPLOAD_STAGING_PREFIX` in `keys.ts`); callers copy verified bytes to the served key on completion.
  - `ByteBudget` (from `byte-budget.ts`, also provided by the module) - one process-wide cap on bytes held in memory for upload checks, sized by `UPLOAD_VERIFY_MEMORY_MB`. `acquire(bytes, timeoutMs)` resolves with a release function, granting in arrival order, or rejects with `ByteBudgetTimeoutError`. A request larger than the budget is cut to the budget and runs alone.
- **Other**
  - `keys.ts` - `objectKey(bucket, path)`.
  - `corsRule()` (exported from `storage.service.ts`) - the CORS rule browsers need: origins from `allowedOrigins()` plus `http://localhost:3000`, methods PUT/GET/HEAD, header `Content-Type`, exposes `ETag`.
  - **Development bootstrap** (`onModuleInit`): when `NODE_ENV` is not `production` and `S3_ENDPOINT` is set, it creates the bucket if missing and applies `corsRule()`. Production buckets are set up once by hand (see [docs/content/platform-migration.md](../../../docs/content/platform-migration.md)). If the store is unreachable it only logs a warning.

The S3 client only sends checksums when an operation requires them (`requestChecksumCalculation: 'WHEN_REQUIRED'`), because the SDK's default checksums get baked into presigned URLs and non-AWS stores reject them.

## Used by

- `src/erasure`, `src/retention`, `src/auth/auth.service.ts` - the erasure log's copy under `ERASURE_LOG_S3_PREFIX`, deleting purged files' objects, deleting a deleted account's files and avatar.
- `src/file-manager/file-manager.service.ts` - uploads, downloads, presigned upload tickets, deletes for the file manager (and, through it, course files and student submissions).
- `src/images/images.service.ts` - avatar uploads (direct and presigned) and serving.
- Both use `objectKey()` to build keys. No other module talks to the store.

## Depends on

- `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
- `allowedOrigins()` from `src/config/origins.ts` (for the CORS rule).

## Data

No database tables. Objects in the S3 bucket under `<area>/<path>` keys.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `S3_BUCKET` | `gradebook` | The one bucket. |
| `S3_ENDPOINT` | unset (AWS S3) | Store endpoint, e.g. `http://127.0.0.1:8333` for local SeaweedFS. Also turns on the development bucket bootstrap. |
| `S3_PUBLIC_ENDPOINT` | `S3_ENDPOINT` | Endpoint presigned URLs are signed for (what browsers and phones reach). |
| `S3_REGION` | `auto` | Region. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | unset (SDK default credential chain) | Credentials. |
| `S3_FORCE_PATH_STYLE` | `true` when an endpoint is set | Path-style addressing; set `false` to turn it off for a custom endpoint, `true` to force it on AWS. |
| `UPLOAD_VERIFY_MEMORY_MB` | `256` | Size of the `ByteBudget` the module provides. |
| `NODE_ENV` | - | `production` skips the bucket bootstrap. |
| `FRONTEND_URL` | - | Read through `allowedOrigins()` for the CORS rule. |

`S3_PUBLIC_URL` (an avatar CDN host) is read by `src/images`, not here.

## Files

| File | Purpose |
| --- | --- |
| `storage.module.ts` | Global module providing `StorageService` and the upload-check `ByteBudget`. |
| `byte-budget.ts` | `ByteBudget`, `ByteBudgetTimeoutError`, `uploadVerifyBudgetBytes()`. |
| `storage.service.ts` | `StorageService`, `corsRule()`, the S3 client factory. |
| `keys.ts` | `objectKey()`: `(bucket, path)` to S3 key. |

## Tests

```bash
cd backend && bun test src/storage
```

- `storage.service.test.ts` - `readCapped` stops past its cap; `uploadUrl` signs type and length; `copy` sends a `CopyObject` that replaces the content type.
- `byte-budget.test.ts` - grants and releases, waiting and timing out, arrival order, a request larger than the budget, and reading `UPLOAD_VERIFY_MEMORY_MB`.

Services that use storage stub `StorageService` in their own tests (for example `src/images/images.service.test.ts`, `src/file-manager/file-manager.service.test.ts`).

## See also

- [docs/content/backend/file-manager.md](../../../docs/content/backend/file-manager.md), [docs/content/backend/images.md](../../../docs/content/backend/images.md)
- [docs/content/environment-variables.md](../../../docs/content/environment-variables.md)
- [src/file-manager/README.md](../file-manager/README.md), [src/images/README.md](../images/README.md), [src/queue/README.md](../queue/README.md)
