import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import { ImagesService } from './images.service';
import { ObjectTooLargeError } from '@/storage/storage.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';

/** The URL shape avatars were stored under before the move to S3. */
const PUBLIC_PREFIX =
  'https://proj.example.co/storage/v1/object/public/images/';

type MockOpts = {
  /** The user_profile row the database returns (null: no such row). */
  profile?: { data: any; error: any };
  exists?: boolean;
  downloadType?: string;
  /** Bytes the stored object holds (for upload completion). */
  stored?: Buffer;
};

/** A database mock whose user_profile row is `opts.profile`. */
function makePrisma(opts: MockOpts = {}) {
  const prisma = createMockPrisma();
  const row = opts.profile ? opts.profile.data : { id: 'u', avatar_url: 'x' };
  prisma.user_profile.findUnique.mockResolvedValue(row);
  prisma.user_profile.update.mockImplementation(async ({ where, data }) => ({
    id: where.id,
    ...data,
  }));
  return prisma;
}

/** Build an ImagesService over storage and database mocks. */
function makeService(opts: MockOpts, cache: unknown) {
  return new ImagesService(
    makeStorage(opts) as any,
    makePrisma(opts) as any,
    cache as any,
  );
}

/** A StorageService stand-in. */
function makeStorage(opts: MockOpts = {}) {
  const type = opts.downloadType ?? 'image/png';
  const stored = opts.stored ?? pngBytes();
  return {
    put: mock(() => Promise.resolve()),
    delete: mock(() => Promise.resolve()),
    exists: mock(() =>
      Promise.resolve(
        opts.exists === false
          ? null
          : { size: stored.byteLength, contentType: type },
      ),
    ),
    get: mock(() =>
      Promise.resolve({
        body: Readable.from([Buffer.alloc(8)]),
        contentType: type,
        size: 8,
      }),
    ),
    getBuffer: mock(() => Promise.resolve(stored)),
    uploadUrl: mock((key: string) => Promise.resolve(`https://s3.test/${key}?sig`)),
  };
}

function pngBytes(extra = 0): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(8 + extra, 1),
  ]);
}
function jpegBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(12, 1),
  ]);
}
function webpBytes(): Buffer {
  const b = Buffer.alloc(16, 0);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  return b;
}

describe('ImagesService.completeResumableUpload (path IDOR)', () => {
  let cache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    cache = createMockCacheService();
  });

  function svc(opts = {}) {
    return makeService(opts, cache);
  }

  test('accepts the caller-owned canonical path', async () => {
    const res = await svc().completeResumableUpload(
      'user-1',
      'uploads/avatars/user-1.png',
    );
    expect(res.avatar_url).toContain('avatars/user-1.png');
  });

  test('accepts the caller-owned path with a different allowed extension', async () => {
    const res = await svc().completeResumableUpload(
      'user-1',
      'uploads/avatars/user-1.webp',
    );
    expect(res.avatar_url).toContain('avatars/user-1.webp');
  });

  test("rejects another user's object", async () => {
    expect(
      await expectRejection(
        svc().completeResumableUpload('user-1', 'uploads/avatars/victim.png'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a path outside the avatars/ namespace', async () => {
    expect(
      await expectRejection(
        svc().completeResumableUpload('user-1', 'secrets/user-1.png'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a traversal attempt', async () => {
    expect(
      await expectRejection(
        svc().completeResumableUpload('user-1', 'avatars/../secrets'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a smuggled query string on the path', async () => {
    expect(
      await expectRejection(
        svc().completeResumableUpload('user-1', 'uploads/avatars/user-1.png?x=1'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects an empty path', async () => {
    expect(
      await expectRejection(svc().completeResumableUpload('user-1', '')),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects the canonical path of a DIFFERENT user even if it exists', async () => {
    // exists() would return true; ownership check must still block it.
    const s = makeService({ exists: true }, cache);
    expect(
      await expectRejection(
        s.completeResumableUpload('attacker', 'uploads/avatars/owner.png'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });
});

describe('ImagesService.completeResumableUpload (content checks)', () => {
  let cache: ReturnType<typeof createMockCacheService>;
  beforeEach(() => {
    cache = createMockCacheService();
  });
  /** Complete an upload whose staged object holds `stored` as `type`. */
  const complete = (stored: Buffer, type: string) =>
    makeService({ stored, downloadType: type }, cache).completeResumableUpload(
      'u',
      'uploads/avatars/u.png',
    );

  test('accepts a real PNG', async () => {
    const res = await complete(pngBytes(), 'image/png');
    expect(res.avatar_url).toBeDefined();
  });

  test('accepts a real JPEG', async () => {
    const res = await complete(jpegBytes(), 'image/jpeg');
    expect(res.avatar_url).toBeDefined();
  });

  test('accepts a real WebP', async () => {
    const res = await complete(webpBytes(), 'image/webp');
    expect(res.avatar_url).toBeDefined();
  });

  test('rejects a missing content type', async () => {
    expect(
      await expectRejection(complete(pngBytes(), '')),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a disallowed content type (e.g. SVG)', async () => {
    expect(
      await expectRejection(complete(pngBytes(), 'image/svg+xml')),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects bytes that do not match the declared image type (PNG header lie)', async () => {
    const htmlBytes = Buffer.from('<html><script>alert(1)</script></html>');
    expect(
      await expectRejection(complete(htmlBytes, 'image/png')),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a JPEG declared as PNG (mismatched signature)', async () => {
    expect(
      await expectRejection(complete(jpegBytes(), 'image/png')),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a too-short object that cannot carry a signature', async () => {
    expect(
      await expectRejection(complete(Buffer.from([0x89, 0x50]), 'image/png')),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects and deletes an object over 5MB before reading it', async () => {
    const storage = makeStorage({ stored: Buffer.alloc(5 * 1024 * 1024 + 1) });
    const svc = new ImagesService(
      storage as any,
      createMockPrisma() as any,
      cache as any,
    );
    expect(
      await expectRejection(
        svc.completeResumableUpload('u', 'uploads/avatars/u.png'),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(storage.getBuffer).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith('images/uploads/avatars/u.png');
    expect(storage.put).not.toHaveBeenCalled();
  });
});

describe('ImagesService.createResumableUpload (ticket checks)', () => {
  const svc = () => makeService({}, createMockCacheService());

  test('refuses a declared size over 5MB', async () => {
    expect(
      await expectRejection(
        svc().createResumableUpload('u', 'a.png', 'image/png', 5 * 1024 * 1024 + 1),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('refuses a type that is not an allowed image', async () => {
    expect(
      await expectRejection(
        svc().createResumableUpload('u', 'a.svg', 'image/svg+xml', 100),
      ),
    ).toBeInstanceOf(BadRequestException);
  });
});

describe('ImagesService.getImageFromUserProfile (stored path hardening)', () => {
  let cache: ReturnType<typeof createMockCacheService>;
  beforeEach(() => {
    cache = createMockCacheService();
  });

  function svcWithAvatar(avatar_url: string | null) {
    return makeService(
      { profile: { data: avatar_url ? { avatar_url } : null, error: null } },
      cache,
    );
  }

  test('downloads a well-formed avatars/ object', async () => {
    const res = await svcWithAvatar(
      `${PUBLIC_PREFIX}avatars/user-1.png?t=123`,
    ).getImageFromUserProfile('user-1');
    expect(res.contentType).toBe('image/png');
  });

  test('rejects a stored URL missing the public-object marker', async () => {
    expect(
      await expectRejection(
        svcWithAvatar(
          'https://evil.example/whatever.png',
        ).getImageFromUserProfile('user-1'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a stored URL with traversal in the object path', async () => {
    expect(
      await expectRejection(
        svcWithAvatar(
          `${PUBLIC_PREFIX}avatars/../../secrets.png`,
        ).getImageFromUserProfile('user-1'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a stored URL pointing outside avatars/', async () => {
    expect(
      await expectRejection(
        svcWithAvatar(`${PUBLIC_PREFIX}other/file.png`).getImageFromUserProfile(
          'user-1',
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('throws when the user has no avatar set', async () => {
    expect(
      await expectRejection(
        svcWithAvatar(null).getImageFromUserProfile('user-1'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });
});

describe('ImagesService avatar URLs and direct uploads', () => {
  let cache: ReturnType<typeof createMockCacheService>;
  beforeEach(() => {
    cache = createMockCacheService();
  });

  test('a new avatar URL points at the public API route', async () => {
    const prev = process.env.API_URL;
    process.env.API_URL = 'https://api.example.com/';
    try {
      const res = await makeService({}, cache).completeResumableUpload(
        'u',
        'uploads/avatars/u.png',
      );
      expect(res.avatar_url).toMatch(
        /^https:\/\/api\.example\.com\/api\/images\/avatars\/u\.png\?t=\d+$/,
      );
    } finally {
      if (prev === undefined) delete process.env.API_URL;
      else process.env.API_URL = prev;
    }
  });

  test('reads an avatar stored under the new URL shape', async () => {
    const res = await makeService(
      {
        profile: {
          data: { avatar_url: 'http://x/api/images/avatars/user-1.png?t=1' },
          error: null,
        },
      },
      cache,
    ).getImageFromUserProfile('user-1');
    expect(res.contentType).toBe('image/png');
  });

  test('readAvatar refuses anything outside avatars/', async () => {
    const svc = makeService({}, cache);
    expect(await svc.readAvatar('avatars/../x')).toBeNull();
    expect(await svc.readAvatar('other/x.png')).toBeNull();
  });

  test('createResumableUpload returns a presigned PUT ticket', async () => {
    const res = await makeService({}, cache).createResumableUpload(
      'u',
      'me.png',
      'image/png',
      1000,
    );
    expect(res).toMatchObject({
      path: 'uploads/avatars/u.png',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
    });
    expect(res.uploadUrl).toContain('images/uploads/avatars/u.png');
  });

  test('the ticket is short-lived and bound to the declared size', async () => {
    const storage = makeStorage();
    const svc = new ImagesService(
      storage as any,
      createMockPrisma() as any,
      cache as any,
    );
    await svc.createResumableUpload('u', 'me.png', 'image/png', 1000);
    expect(storage.uploadUrl.mock.calls[0]).toEqual([
      'images/uploads/avatars/u.png',
      'image/png',
      300,
      1000,
    ] as any);
  });

  test('a fractional size is refused', async () => {
    expect(
      await expectRejection(
        makeService({}, cache).createResumableUpload('u', 'a.png', 'image/png', 1.5),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('completion serves the verified bytes from avatars/ and drops the staged object', async () => {
    const storage = makeStorage();
    const prisma = createMockPrisma();
    prisma.user_profile.update.mockResolvedValue({ id: 'u', avatar_url: 'x' });
    const svc = new ImagesService(storage as any, prisma as any, cache as any);
    const res = await svc.completeResumableUpload('u', 'uploads/avatars/u.png');

    expect(storage.getBuffer.mock.calls[0]).toEqual([
      'images/uploads/avatars/u.png',
      5 * 1024 * 1024,
    ] as any);
    const [putKey, putBody] = storage.put.mock.calls[0] as unknown as [string, Buffer];
    expect(putKey).toBe('images/avatars/u.png');
    expect(putBody.equals(pngBytes())).toBe(true);
    expect(storage.delete).toHaveBeenCalledWith('images/uploads/avatars/u.png');
    expect(res.avatar_url).toContain('/images/avatars/u.png');
    expect(res.avatar_url).not.toContain('uploads/');
  });

  test('the served avatar key itself is not accepted as an upload path', async () => {
    expect(
      await expectRejection(
        makeService({}, cache).completeResumableUpload('u', 'avatars/u.png'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('an object that grew past the cap after HEAD is rejected and deleted', async () => {
    const storage = makeStorage();
    storage.getBuffer.mockImplementation(() =>
      Promise.reject(new ObjectTooLargeError('k', 1)),
    );
    const svc = new ImagesService(
      storage as any,
      createMockPrisma() as any,
      cache as any,
    );
    const err = await expectRejection(
      svc.completeResumableUpload('u', 'uploads/avatars/u.png'),
    );
    expect((err as Error).message).toContain('too large');
    expect(storage.delete).toHaveBeenCalledWith('images/uploads/avatars/u.png');
    expect(storage.put).not.toHaveBeenCalled();
  });

  test('completion rejects an object that is not the image it claims', async () => {
    const svc = makeService({ stored: Buffer.from('<svg>nope</svg>....') }, cache);
    expect(
      await expectRejection(svc.completeResumableUpload('u', 'uploads/avatars/u.png')),
    ).toBeInstanceOf(BadRequestException);
  });

  test('completion fails when nothing was uploaded', async () => {
    const svc = makeService({ exists: false }, cache);
    expect(
      await expectRejection(svc.completeResumableUpload('u', 'uploads/avatars/u.png')),
    ).toBeInstanceOf(BadRequestException);
  });
});
