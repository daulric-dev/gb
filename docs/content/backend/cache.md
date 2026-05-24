---
sidebar_label: Cache
---

# Cache Module

The cache module provides a pluggable caching layer that sits in front of Supabase database queries. When a service fetches data from Supabase, the result is cached for a configurable period. Subsequent requests for the same data are served from the cache instead of hitting Supabase again. On writes (inserts, updates, upserts), the cache is invalidated or updated to keep it consistent with the database.

## How It Works

```
Client Request
    │
    ▼
  Service
    │
    ├── GET: cache.get(key)
    │     ├── Cache HIT  → return cached data (no Supabase call)
    │     └── Cache MISS → fetch from Supabase → cache.set(key, data, ttl) → return data
    │
    ├── INSERT / UPSERT: write to Supabase → cache.set(key, newData, ttl)
    │
    ├── UPDATE (list): write to Supabase → cache.delete(key) or cache.deleteByPrefix(prefix)
    │
    └── DELETE: delete from Supabase → cache.delete(key) or cache.deleteByPrefix(prefix)
```

This pattern ensures:
- **Reads are fast** - repeated requests for the same data don't hit Supabase.
- **Writes stay consistent** - the cache is invalidated or updated immediately after a successful write to Supabase, so subsequent reads reflect the latest data.
- **TTL provides a safety net** - even if a cache update is missed, stale data expires automatically.

## Architecture

```
CacheService (Injectable, Global)
├── implements CacheStore interface
├── delegates to one of:
│   ├── MemoryStore (default, in-process Map)
│   └── RedisStore (requires Redis via Bun's built-in RedisClient)
```

The `CacheService` reads `USE_REDIS` at construction time. If `true`, it connects to Redis using `REDIS_URL`. Otherwise, it falls back to an in-memory `Map`.

The `CacheModule` is registered globally via `@Global()` in `AppModule`, so all services can inject `CacheService` without importing the module.

## File Structure

```
backend/src/cache/
├── cache.module.ts              # NestJS module (@Global, exports CacheService)
├── cache.service.ts             # Main service, selects store at startup
└── stores/
    ├── index.ts                 # Barrel exports
    ├── cache.interface.ts       # CacheInterface definition
    ├── MemoryStore.ts           # In-memory implementation
    └── RedisStore.ts            # Redis implementation (Bun's built-in RedisClient)
```

## CacheInterface

All stores implement this interface:

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `get(key: string): Promise<any>` | Retrieve a cached value by key. Returns `null` on miss or expiry. |
| `set` | `set(key: string, value: any, ttl: number): Promise<void>` | Store a value with a TTL in seconds. |
| `delete` | `delete(key: string): Promise<void>` | Remove a specific key. |
| `deleteByPrefix` | `deleteByPrefix(prefix: string): Promise<void>` | Remove all keys starting with the given prefix. |
| `clear` | `clear(): Promise<void>` | Remove all cached entries. |

## Store Implementations

### MemoryStore

- Uses a `Map<string, Entry>` where `Entry` contains `{ value, expires }`.
- `expires` is `Date.now() + (ttl * 1000)` at write time (TTL is in seconds, stored as ms).
- `get()` checks expiry and auto-evicts stale entries on read.
- Suitable for development and single-instance deployments.
- Data is lost on process restart.

### RedisStore

- Uses Bun's built-in `RedisClient` to connect to a Redis instance.
- Values are JSON-serialized on `set()` and JSON-parsed on `get()`.
- TTL is set via `SET key value EX ttl` (seconds).
- `deleteByPrefix()` uses `SCAN` with `MATCH` to find and delete matching keys without blocking.
- `clear()` calls `FLUSHALL ASYNC` — use with caution in shared Redis instances.
- Suitable for production and multi-instance deployments where cache must be shared.
- Sends a `PING` every 60 seconds to keep the connection alive against providers (e.g. Upstash) that close idle TCP sockets.
- Constructed with `autoReconnect: true`, `maxRetries: 20`, `idleTimeout: 0`.
- Disposed via `OnModuleDestroy` — clears the keepalive interval and closes the socket on shutdown.

## Resilience

The cache is treated as a best-effort layer, never a hard dependency. `CacheService` wraps every store call in try/catch so a Redis outage cannot take down request handling:

| Operation | On store error |
|-----------|----------------|
| `get` | Logs error, returns `null` (treated as cache miss → caller falls through to Supabase) |
| `set` | Logs error, no-op |
| `update` | Logs error, returns `false` |
| `delete` / `deleteByPrefix` / `clear` | Logs error, no-op |

This means callers do not need to catch cache errors themselves. Catch blocks in services should only convert *domain* errors (e.g. Supabase row-not-found) into `HttpException`s — they must not re-wrap arbitrary errors, or genuine 500s will be hidden behind misleading 404s.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `USE_REDIS` | No | `false` | Set to `true` to use Redis instead of in-memory cache |
| `REDIS_URL` | Only if `USE_REDIS=true` | - | Redis connection URL (e.g., `redis://localhost:6379`) |

## Usage Pattern

Since `CacheModule` is global, any service can inject `CacheService` directly without importing the module:

```typescript
import { CacheService } from '@/cache/cache.service';

@Injectable()
export class SomeService {
  constructor(private readonly cache: CacheService) {}
}
```

### Cached Read (read-through)

Check the cache before querying Supabase. On a miss, fetch from Supabase and populate the cache.

```typescript
async getProfile(userId: string) {
  const cached = await this.cache.get(`profile:${userId}`);
  if (cached) return cached;

  const { data } = await supabase
    .from('user_profile')
    .select('*')
    .eq('id', userId)
    .single();

  if (data) {
    await this.cache.set(`profile:${userId}`, data, 300);
  }
  return data;
}
```

### Cached Write (write-through)

After a successful write to Supabase, update the cache so reads immediately reflect the new data.

```typescript
async updateProfile(userId: string, dto: UpdateProfileDto) {
  const { data } = await supabase
    .from('user_profile')
    .update({ first_name: dto.firstName })
    .eq('id', userId)
    .select('*')
    .single();

  if (data) {
    await this.cache.set(`profile:${userId}`, data, 300);
  }
  return data;
}
```

### Cache Invalidation on Delete

Remove the cache entry when the underlying data is deleted.

```typescript
async deleteAccount(userId: string) {
  await supabase.from('user_profile').delete().eq('id', userId);
  await this.cache.delete(`profile:${userId}`);
}
```

### Prefix Invalidation

When cache keys include variable suffixes (e.g., query parameters), use `deleteByPrefix` to clear all variants at once.

```typescript
async enrollStudent(classId: string, dto: EnrollStudentDto) {
  // ... enroll logic ...
  // Clears enrolled:classId:*, covering all userId/subjectId combinations
  await this.cache.deleteByPrefix(`enrolled:${classId}`);
}
```

### Cross-Service Invalidation

Some write operations in one service invalidate caches owned by another. For example, saving a grade invalidates computation caches in `CalculationService`.

```typescript
// In GradeService
private async invalidateCalcCaches() {
  await this.cache.deleteByPrefix('calc:');
}

async bulkCreate(userId: string, dto: BulkGradeDto, token: string) {
  // ... save grades ...
  await this.invalidateCalcCaches();
}
```

## Cached Services

### AuthService

| Method | Strategy | Cache Key | TTL |
|--------|----------|-----------|-----|
| `getProfile` | Read-through | `profile:{userId}` | 300s |
| `verifyOtp` | Warm cache | `profile:{userId}` | 300s |
| `onboard` | Write-through | `profile:{userId}` | 300s |
| `updateProfile` | Write-through | `profile:{userId}` | 300s |
| `deleteAccount` | Invalidate | `profile:{userId}` | - |

### ClassService

| Method | Strategy | Cache Key | TTL |
|--------|----------|-----------|-----|
| `getMyClasses` | Read-through | `my-classes:{userId}` or `my-classes:{userId}:{yearId}` | 300s |
| `getTeachers` | Read-through | `class-teachers:{classId}` | 300s |
| `getMySubjectsForClass` | Read-through | `my-subjects:{userId}:{classId}` | 300s |
| `getSchoolTeachers` | Read-through | `school-teachers:{schoolId}` | 300s |
| `createClass` | Invalidate | `my-classes:{userId}`, `my-classes:{userId}:{yearId}` | - |
| `updateClass` | Invalidate | `class-teachers:{classId}` | - |
| `deleteClass` | Invalidate | `class-teachers:{classId}` | - |
| `addTeacher` | Invalidate | `class-teachers:{classId}`, `my-classes:{teacherId}`, `my-subjects:{teacherId}:{classId}` | - |
| `removeTeacher` | Invalidate | `class-teachers:{classId}`, `my-classes:{teacherId}`, `my-subjects:{teacherId}:{classId}` | - |

### EnrollmentService

| Method | Strategy | Cache Key | TTL |
|--------|----------|-----------|-----|
| `getEnrolledStudents` | Read-through | `enrolled:{classId}:{userId\|all}:{subjectId\|all}` | 300s |
| `getStudentSubjects` | Read-through | `student-subjects:{classId}:{studentId}` | 300s |
| `enroll` | Prefix invalidate | `enrolled:{classId}*` | - |
| `bulkEnroll` | Prefix invalidate | `enrolled:{classId}*` | - |
| `unenroll` | Prefix invalidate | `enrolled:{classId}*`, `student-subjects:{classId}:{studentId}` | - |
| `assignSubjects` | Prefix invalidate | `enrolled:{classId}*`, `student-subjects:{classId}:{studentId}` | - |
| `bulkAssignSubjects` | Prefix invalidate | `enrolled:{classId}*`, `student-subjects:{classId}:{studentId}` per student | - |
| `removeSubject` | Prefix invalidate | `enrolled:{classId}*`, `student-subjects:{classId}:{studentId}` | - |

### CalculationService

| Method | Strategy | Cache Key | TTL |
|--------|----------|-----------|-----|
| `calculateClassTermResults` | Read-through | `calc:class-term:{groupId}:{termId}` | 600s |
| `calculateClassYearResults` | Read-through | `calc:class-year:{groupId}:{yearId}` | 600s |

Calculation caches are invalidated by `GradeService` and `AssessmentService` via `deleteByPrefix('calc:')`.

### SchoolService

| Method | Strategy | Cache Key | TTL |
|--------|----------|-----------|-----|
| `findAll` | Read-through | `schools:all` | 600s |
| `create` | Invalidate | `schools:all` | - |

### SubjectService

| Method | Strategy | Cache Key | TTL |
|--------|----------|-----------|-----|
| `findAll` | Read-through | `subjects:{schoolId}` | 300s |
| `create` | Invalidate | `subjects:{schoolId}` | - |
| `update` | Prefix invalidate | `subjects:*` | - |
| `delete` | Prefix invalidate | `subjects:*` | - |

### StudentService

| Method | Strategy | Cache Key | TTL |
|--------|----------|-----------|-----|
| `findAll` (no search) | Read-through | `students:{schoolId}` | 300s |
| `create` | Invalidate | `students:{schoolId}` | - |
| `update` | Prefix invalidate | `students:*` | - |

Search queries bypass the cache entirely.

### AcademicYearService

| Method | Strategy | Cache Key | TTL |
|--------|----------|-----------|-----|
| `findAll` | Read-through | `academic-years:{schoolId}` | 300s |
| `findActive` | Read-through | `academic-year-active:{schoolId}` | 300s |
| `create` | Invalidate | `academic-years:{schoolId}`, `academic-year-active:{schoolId}` | - |
| `update` | Prefix invalidate | `academic-year*` | - |
| `setActive` | Prefix invalidate | `academic-year*` | - |
| `deactivate` | Prefix invalidate | `academic-year*` | - |

### TermService

| Method | Strategy | Cache Key | TTL |
|--------|----------|-----------|-----|
| `findByYear` | Read-through | `terms:{yearId}` | 300s |
| `create` | Invalidate | `terms:{yearId}` | - |
| `update` | Prefix invalidate | `terms:*` | - |
| `delete` | Prefix invalidate | `terms:*` | - |

### GradeService (write-only, no cached reads)

| Method | Cross-Invalidation |
|--------|--------------------|
| `create` | `calc:*` |
| `bulkCreate` | `calc:*` |
| `update` | `calc:*` |
| `exclude` | `calc:*` |

### AssessmentService (write-only, no cached reads)

| Method | Cross-Invalidation |
|--------|--------------------|
| `create` | `calc:*` |
| `update` | `calc:*` |
| `exclude` | `calc:*` |
| `delete` | `calc:*` |

## Cache Key Conventions

| Pattern | Example | Description |
|---------|---------|-------------|
| `entity:{id}` | `profile:abc-123` | Single record by ID |
| `entity:{scope}` | `subjects:school-456` | List scoped to a parent |
| `entity:{id}:{qualifier}` | `my-classes:user-1:year-2` | List scoped to multiple dimensions |
| `entity:{id}:{q1}:{q2}` | `enrolled:class-1:user-2:subj-3` | List with multiple query params |
| `calc:{type}:{group}:{period}` | `calc:class-term:grp-1:term-2` | Computed result keyed by inputs |

## Notes

- The `CacheModule` is `@Global()` and exports `CacheService`, so any service can inject it without importing the module.
- The store selection happens once at construction time and cannot be changed at runtime.
- The MemoryStore auto-evicts expired entries on read.
- `deleteByPrefix` is used when cache keys include variable suffixes that can't be predicted at invalidation time.
- For Redis, `deleteByPrefix` uses cursor-based `SCAN` to avoid blocking the server.
- Calculation caches use a longer TTL (600s) since they are the most expensive operations to recompute.
- Schools also use 600s TTL since the list rarely changes.

## History

For dated changes to this module, see [Changelog → 2026-05-24 Redis resilience](../changelog/2026-05-24/redis-resilience.md).
