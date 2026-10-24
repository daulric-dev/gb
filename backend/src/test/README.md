# Test helpers (`src/test`)

Shared helpers for the backend's unit tests. They are imported only by `*.test.ts` files (as `@/test/...`); no application code depends on them, and `tsconfig.build.json` excludes `src/test/**` (and every `*.test.ts`) from the build.

The suite runs on **Bun's test runner** (`bun:test`), not Jest, even though `package.json` still carries a leftover Jest config block. Tests live next to the code they test as `<name>.test.ts`.

## Files

| File | Exports | What it is for |
| --- | --- | --- |
| `prisma-mock.ts` | `createMockPrisma()`, `MockPrisma`, `MockModel` | A stand-in for `PrismaService`. Every `prisma.<model>.<method>` is a Bun `mock()` created on first access, resolving to an empty result: `findUnique`/`findFirst` -> `null`, `findMany`/`groupBy`/`createManyAndReturn`/`updateManyAndReturn` -> `[]`, `count` -> `0`, `create`/`update`/`upsert`/`delete`/`aggregate` -> `{}`, `createMany`/`updateMany`/`deleteMany` -> `{ count: 0 }`, and the `...OrThrow` variants throw. `$queryRaw`/`$queryRawUnsafe` resolve `[]`, `$executeRaw`/`$executeRawUnsafe` resolve `0`. `$transaction` runs an interactive callback against the same mock, or `Promise.all`s an array. Used by about 45 test files. |
| `prisma-mock.test.ts` | - | Tests for `createMockPrisma()` itself. |
| `mocks.ts` | `createMockCacheService()`, `expectRejection()` | An in-memory `CacheService` (`get`, `set`, `update`, `delete`, `deleteByPrefix`, `clear`, and `_store` - the backing `Map` - for assertions). `update()` only runs when the key exists, like the real one. `expectRejection(promise)` awaits a promise that must reject and returns the error. |
| `billing-fakes.ts` | `FakeProvider`, `subRow()`, `invoiceRow()` | A `PaymentProvider` whose every method is a Bun mock with a harmless default (checkout URL, portal URL, no webhook events), with a settable `configured` flag and `subscription` or `invoice` mode; plus `billing.subscription` and `billing.invoice` rows with overridable defaults. Used by the `src/billing` tests. |
| `saml-idp.ts` | `TEST_IDP`, `OTHER_IDP`, `buildSamlResponse()`, `SamlResponseInput` | A pretend SAML identity provider: two throwaway self-signed key pairs (never trusted anywhere) and a builder for a base64 `SAMLResponse` whose assertion is signed like a real IdP's. Options cover issuer, audience, ACS URL, `InResponseTo`, NameID and format, attributes, clock and validity, and an unsigned or wrong-key signer. Used by `src/sso/sso.test.ts` and `src/email-domain/email-domain.service.test.ts`, and handy for a manual SAML round trip (see [docs/content/sso.md](../../../docs/content/sso.md#testing-locally)). |

## How to write a unit test here

Services take their dependencies through the constructor, so a unit test builds the service by hand with fakes - no Nest testing module, database or Redis is needed.

```ts
// src/term/term.service.test.ts (abridged)
import { describe, test, expect, beforeEach } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { TermService } from './term.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

describe('TermService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let service: TermService;

  beforeEach(() => {
    prisma = createMockPrisma();
    cache = createMockCacheService();
    // Arrange only what this code path reads; everything else is empty.
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    service = new TermService(prisma as any, cache as any);
  });

  test('is 404 when the term is not in the caller school', async () => {
    prisma.term.findFirst.mockResolvedValue(null);
    const err = await expectRejection(service.findOne('user-1', 'term-1'));
    expect(err).toBeInstanceOf(NotFoundException);
    // Assert on the query that was sent.
    expect(prisma.term.findFirst.mock.calls[0][0].where).toEqual({
      id: 'term-1',
      academic_year: { school_id: 'school-1' },
    });
  });
});
```

Guidelines:

- **Arrange with `mockResolvedValue` / `mockImplementation`** on the model methods the code calls. `mockImplementation(async ({ data }) => ({ id: 'x', ...data }))` is a quick way to echo writes back.
- **Assert on calls** (`prisma.<model>.<method>.mock.calls[i][0]`) to check scoping (`school_id` in the `where`), and on `cache._store` to check cache keys.
- **Raw SQL** (`$queryRaw`) is a tagged template: the mock receives the template strings and values as arguments, so assert on the values to check, for example, that a plaintext secret never reaches the database (see `src/student-account/student-membership.service.test.ts`).
- **Other services** the code under test injects can be plain objects with just the methods used, cast with `as any` (see `src/student-portal/student-portal.service.test.ts`).
- **Guards** take an `ExecutionContext`; build a minimal one with `switchToHttp().getRequest()` returning your request object (see `src/student-portal/student.guard.test.ts`).
- **Env-dependent code**: set `process.env` in the test and restore it afterwards (see `src/sso/sso.test.ts`).
- Put a helper here only when several modules need it; one-module fixtures belong in that module's test file.

## Running tests

```bash
cd backend
bun test src                    # everything (same as `bun run test`; prisma generate runs first via pretest)
bun test src/term               # one folder
bun test src/term/term.service.test.ts
bun test src --watch
```

`bun test` does **not** typecheck, and `nest build` excludes test files, so type errors in a test go unnoticed by both. Run `bunx tsc --noEmit` in `backend/` to catch them.

## See also

- [docs/content/developer-guide.md](../../../docs/content/developer-guide.md) (Testing)
- [src/README.md](../README.md)
