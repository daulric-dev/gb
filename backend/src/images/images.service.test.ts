import { describe, test, expect, beforeEach } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { ImagesService } from './images.service';
import {
  createMockQueryBuilder,
  createMockCacheService,
  expectRejection,
} from '@/test/mocks';

const PUBLIC_PREFIX =
  'https://proj.supabase.co/storage/v1/object/public/images/';

/** Build a Supabase mock tailored to ImagesService's needs. */
function makeSupabase(
  opts: {
    profile?: { data: any; error: any };
    exists?: boolean;
    downloadType?: string;
  } = {},
) {
  const builder = createMockQueryBuilder(
    opts.profile ?? { data: { id: 'u', avatar_url: 'x' }, error: null },
  );
  const storage = {
    exists: () => Promise.resolve({ data: opts.exists ?? true, error: null }),
    getPublicUrl: (p: string) => ({
      data: { publicUrl: `${PUBLIC_PREFIX}${p}` },
    }),
    download: () =>
      Promise.resolve({
        data: { type: opts.downloadType ?? 'image/png' },
        error: null,
      }),
  };
  const client = {
    from: () => builder,
    schema: () => ({ from: () => builder }),
    storage: { from: () => storage },
  };
  let uploadCalls = 0;
  return {
    svc: {
      getServiceClient: () => client,
      ensureBucket: () => Promise.resolve(true),
      uploadFile: (_b: string, path: string) => {
        uploadCalls++;
        return Promise.resolve({ path, publicUrl: `${PUBLIC_PREFIX}${path}` });
      },
    },
    uploadCount: () => uploadCalls,
  };
}

const config = { get: () => 'https://proj.supabase.co' } as any;

// Minimal MultipartFile stand-in.
function fakeFile(
  buffer: Buffer,
  mimetype: string | undefined,
  filename = 'a.png',
) {
  return { toBuffer: () => Promise.resolve(buffer), mimetype, filename } as any;
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
    return new ImagesService(
      makeSupabase(opts).svc as any,
      cache as any,
      config,
    );
  }

  test('accepts the caller-owned canonical path', async () => {
    const res = await svc().completeResumableUpload(
      'user-1',
      'avatars/user-1.png',
    );
    expect(res.avatar_url).toContain('avatars/user-1.png');
  });

  test('accepts the caller-owned path with a different allowed extension', async () => {
    const res = await svc().completeResumableUpload(
      'user-1',
      'avatars/user-1.webp',
    );
    expect(res.avatar_url).toContain('avatars/user-1.webp');
  });

  test("rejects another user's object", async () => {
    expect(
      await expectRejection(
        svc().completeResumableUpload('user-1', 'avatars/victim.png'),
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
        svc().completeResumableUpload('user-1', 'avatars/user-1.png?x=1'),
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
    const s = new ImagesService(
      makeSupabase({ exists: true }).svc as any,
      cache as any,
      config,
    );
    expect(
      await expectRejection(
        s.completeResumableUpload('attacker', 'avatars/owner.png'),
      ),
    ).toBeInstanceOf(BadRequestException);
  });
});

describe('ImagesService.setImageToUserProfile (content-type validation)', () => {
  let cache: ReturnType<typeof createMockCacheService>;
  beforeEach(() => {
    cache = createMockCacheService();
  });
  const svc = () =>
    new ImagesService(makeSupabase().svc as any, cache as any, config);

  test('accepts a real PNG', async () => {
    const res = await svc().setImageToUserProfile(
      'u',
      fakeFile(pngBytes(), 'image/png'),
    );
    expect(res.avatar_url).toBeDefined();
  });

  test('accepts a real JPEG', async () => {
    const res = await svc().setImageToUserProfile(
      'u',
      fakeFile(jpegBytes(), 'image/jpeg'),
    );
    expect(res.avatar_url).toBeDefined();
  });

  test('accepts a real WebP', async () => {
    const res = await svc().setImageToUserProfile(
      'u',
      fakeFile(webpBytes(), 'image/webp'),
    );
    expect(res.avatar_url).toBeDefined();
  });

  test('rejects a missing mimetype (no longer silently allowed)', async () => {
    expect(
      await expectRejection(
        svc().setImageToUserProfile('u', fakeFile(pngBytes(), undefined)),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a disallowed mimetype (e.g. SVG)', async () => {
    expect(
      await expectRejection(
        svc().setImageToUserProfile('u', fakeFile(pngBytes(), 'image/svg+xml')),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects bytes that do not match the declared image type (PNG header lie)', async () => {
    const htmlBytes = Buffer.from('<html><script>alert(1)</script></html>');
    expect(
      await expectRejection(
        svc().setImageToUserProfile('u', fakeFile(htmlBytes, 'image/png')),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a JPEG declared as PNG (mismatched signature)', async () => {
    expect(
      await expectRejection(
        svc().setImageToUserProfile('u', fakeFile(jpegBytes(), 'image/png')),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects a too-short buffer that cannot carry a signature', async () => {
    expect(
      await expectRejection(
        svc().setImageToUserProfile(
          'u',
          fakeFile(Buffer.from([0x89, 0x50]), 'image/png'),
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('rejects an oversize file before doing anything else', async () => {
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    expect(
      await expectRejection(
        svc().setImageToUserProfile('u', fakeFile(tooBig, 'image/png')),
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
    return new ImagesService(
      makeSupabase({
        profile: { data: avatar_url ? { avatar_url } : null, error: null },
      }).svc as any,
      cache as any,
      config,
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
