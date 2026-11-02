import { afterEach, describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MB,
  effectiveUploadMb,
  loadUploadLimitConfig,
} from './upload-limit.config';
import { UploadLimitService } from './upload-limit.service';
import { UpdateUploadLimitDto } from '@/school/dto/update-upload-limit.dto';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe('loadUploadLimitConfig', () => {
  test('defaults to a 1 GB ceiling and a 100MB school default', () => {
    expect(loadUploadLimitConfig({})).toEqual({ maxMb: 1024, defaultMb: 100 });
  });

  test('reads both settings', () => {
    expect(
      loadUploadLimitConfig({ UPLOAD_MAX_MB: '250', UPLOAD_DEFAULT_MB: '20' }),
    ).toEqual({ maxMb: 250, defaultMb: 20 });
  });

  test('an unset default follows a lower ceiling', () => {
    expect(loadUploadLimitConfig({ UPLOAD_MAX_MB: '50' })).toEqual({
      maxMb: 50,
      defaultMb: 50,
    });
  });

  test('a default above the ceiling is clamped with a warning', () => {
    const warnings: string[] = [];
    const config = loadUploadLimitConfig(
      { UPLOAD_MAX_MB: '50', UPLOAD_DEFAULT_MB: '80', NODE_ENV: 'production' },
      (m) => warnings.push(m),
    );
    expect(config).toEqual({ maxMb: 50, defaultMb: 50 });
    expect(warnings[0]).toContain('above UPLOAD_MAX_MB');
  });

  test('malformed values fail a production boot', () => {
    for (const raw of ['0', '-5', '1.5', 'abc', '100MB', '1025']) {
      expect(() =>
        loadUploadLimitConfig({ NODE_ENV: 'production', UPLOAD_MAX_MB: raw }),
      ).toThrow('UPLOAD_MAX_MB');
    }
  });

  test('malformed values warn and fall back in development', () => {
    const warnings: string[] = [];
    const config = loadUploadLimitConfig(
      { UPLOAD_MAX_MB: 'lots', UPLOAD_DEFAULT_MB: '0' },
      (m) => warnings.push(m),
    );
    expect(config).toEqual({ maxMb: 1024, defaultMb: 100 });
    expect(warnings).toHaveLength(2);
  });
});

describe('effectiveUploadMb', () => {
  const config = { maxMb: 100, defaultMb: 25 };
  test('null follows the default', () => {
    expect(effectiveUploadMb(config, null)).toBe(25);
  });
  test("the school's own setting wins", () => {
    expect(effectiveUploadMb(config, 10)).toBe(10);
  });
  test('never above the ceiling (the env may have been lowered)', () => {
    expect(effectiveUploadMb(config, 500)).toBe(100);
  });
});

function makeService(env: Record<string, string> = {}) {
  for (const key of ['UPLOAD_MAX_MB', 'UPLOAD_DEFAULT_MB']) delete process.env[key];
  Object.assign(process.env, env);
  const prisma = createMockPrisma();
  const cache = createMockCacheService();
  const svc = new UploadLimitService(prisma as any, cache as any);
  return { svc, prisma, cache };
}

describe('UploadLimitService', () => {
  test('a school without a setting gets the platform default', async () => {
    const { svc, prisma } = makeService({ UPLOAD_DEFAULT_MB: '30' });
    prisma.school.findUnique.mockResolvedValue({ max_upload_mb: null });
    expect(await svc.forSchool('s1')).toEqual({
      uploadLimitBytes: 30 * MB,
      uploadLimitMb: 30,
      maxUploadMb: null,
      platformMaxMb: 1024,
      platformDefaultMb: 30,
    });
  });

  test("a school's own setting is clamped to the ceiling", async () => {
    const { svc, prisma } = makeService({ UPLOAD_MAX_MB: '50' });
    prisma.school.findUnique.mockResolvedValue({ max_upload_mb: 200 });
    expect(await svc.bytesForSchool('s1')).toBe(50 * MB);
  });

  test('the setting is cached', async () => {
    const { svc, prisma } = makeService();
    prisma.school.findUnique.mockResolvedValue({ max_upload_mb: 10 });
    await svc.forSchool('s1');
    await svc.forSchool('s1');
    expect(prisma.school.findUnique).toHaveBeenCalledTimes(1);
  });

  test('an update drops the cached setting', async () => {
    const { svc, prisma } = makeService();
    prisma.school.findUnique.mockResolvedValue({ max_upload_mb: 10 });
    await svc.forSchool('s1');

    prisma.school.update.mockResolvedValue({ id: 's1' });
    const out = await svc.setForSchool('s1', 20);
    expect(out.uploadLimitMb).toBe(20);
    expect(prisma.school.update.mock.calls[0][0].data.max_upload_mb).toBe(20);

    prisma.school.findUnique.mockResolvedValue({ max_upload_mb: 20 });
    expect(await svc.bytesForSchool('s1')).toBe(20 * MB);
    expect(prisma.school.findUnique).toHaveBeenCalledTimes(2);
  });

  test('null resets the school to the default', async () => {
    const { svc, prisma } = makeService({ UPLOAD_DEFAULT_MB: '40' });
    prisma.school.update.mockResolvedValue({ id: 's1' });
    const out = await svc.setForSchool('s1', null);
    expect(out).toMatchObject({ maxUploadMb: null, uploadLimitMb: 40 });
    expect(prisma.school.update.mock.calls[0][0].data.max_upload_mb).toBeNull();
  });

  test('a value above the platform ceiling is a 400 naming it', async () => {
    const { svc, prisma } = makeService({ UPLOAD_MAX_MB: '100' });
    const err = await expectRejection(svc.setForSchool('s1', 101));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('platform limit of 100 MB');
    expect(prisma.school.update).not.toHaveBeenCalled();
  });
});

describe('UpdateUploadLimitDto', () => {
  const check = async (body: unknown) =>
    validate(plainToInstance(UpdateUploadLimitDto, body));

  test('accepts a whole number of MB or null', async () => {
    expect(await check({ maxUploadMb: 25 })).toHaveLength(0);
    expect(await check({ maxUploadMb: null })).toHaveLength(0);
  });

  test('rejects zero, fractions, strings and values past the DB range', async () => {
    for (const maxUploadMb of [0, 1.5, '10', 1025]) {
      expect((await check({ maxUploadMb })).length).toBeGreaterThan(0);
    }
  });
});
