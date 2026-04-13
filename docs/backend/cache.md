# Cache Module

The cache module provides a pluggable caching layer for the backend. It supports two storage backends — an in-memory store for development and a Redis store for production — selected at startup via environment variables.

## Architecture

```
CacheService (Injectable)
├── implements CacheStore interface
├── delegates to one of:
│   ├── MemoryStore (default, in-process Map)
│   └── RedisStore (requires Redis via ioredis)
```

The `CacheService` reads `USE_REDIS` at construction time. If `true`, it connects to Redis using `REDIS_URL`. Otherwise, it falls back to an in-memory `Map`.

## File Structure

```
backend/src/cache/
├── cache.module.ts              # NestJS module (exports CacheService)
├── cache.service.ts             # Main service, selects store at startup
└── stores/
    ├── index.ts                 # Barrel exports
    ├── cache.interface.ts       # CacheInterface definition
    ├── MemoryStore.ts           # In-memory implementation
    └── RedisStore.ts            # Redis implementation (ioredis)
```

## CacheInterface

All stores implement this interface:

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `get(key: string): Promise<any>` | Retrieve a cached value by key |
| `set` | `set(key: string, value: any, ttl: number): Promise<void>` | Store a value with a TTL (in seconds for Redis, milliseconds added to `Date.now()` for memory) |
| `delete` | `delete(key: string): Promise<void>` | Remove a specific key |
| `clear` | `clear(): Promise<void>` | Remove all cached entries |

## Store Implementations

### MemoryStore

- Uses a `Map<string, Entry>` where `Entry` contains `{ value, expires }`.
- `expires` is `Date.now() + ttl` at write time.
- Suitable for development and single-instance deployments.
- Data is lost on process restart.

### RedisStore

- Uses `ioredis` to connect to a Redis instance.
- TTL is set via `SET key value EX ttl` (seconds).
- `clear()` calls `FLUSHDB` — use with caution in shared Redis instances.
- Suitable for production and multi-instance deployments where cache must be shared.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `USE_REDIS` | No | `false` | Set to `true` to use Redis instead of in-memory cache |
| `REDIS_URL` | Only if `USE_REDIS=true` | — | Redis connection URL (e.g., `redis://localhost:6379`) |

## Usage

Import `CacheModule` in any feature module that needs caching:

```typescript
import { CacheModule } from '@/cache/cache.module';

@Module({
  imports: [CacheModule],
  // ...
})
export class SomeFeatureModule {}
```

Inject `CacheService` in a service or controller:

```typescript
import { CacheService } from '@/cache/cache.service';

@Injectable()
export class SomeService {
  constructor(private readonly cache: CacheService) {}

  async getData(id: string) {
    const cacheKey = `data:${id}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.fetchFromDb(id);
    await this.cache.set(cacheKey, data, 300); // 5 minutes
    return data;
  }
}
```

## Notes

- The `CacheModule` exports `CacheService`, so any module that imports it can inject the service directly.
- The store selection happens once at construction time and cannot be changed at runtime.
- The memory store does not actively evict expired entries on read — consumers should handle stale data if needed.
