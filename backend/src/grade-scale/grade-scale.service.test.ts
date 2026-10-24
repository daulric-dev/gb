import { beforeEach, describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GradeScaleService } from './grade-scale.service';
import type { BandInputDto } from './dto/band-input.dto';
import { Prisma } from '@/generated/prisma/client';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const CREATED = new Date('2026-01-01T00:00:00.000Z');
const DEFAULT_KEY = 'grade-scale:default:school-1';

const dup = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

function scaleRow(over: Record<string, unknown> = {}) {
  return {
    id: 'gs-1',
    school_id: 'school-1',
    name: 'Letters',
    scale_type: 'letter',
    is_default: false,
    created_at: CREATED,
    updated_at: null,
    ...over,
  };
}

const band = (
  label: string,
  min: number,
  max: number,
  over: Partial<BandInputDto> = {},
): BandInputDto => ({
  label,
  minPercentage: min,
  maxPercentage: max,
  isPass: min >= 50,
  ...over,
});

const ABC = [band('A', 90, 100), band('B', 80, 89.99), band('F', 0, 49.99)];

describe('GradeScaleService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let service: GradeScaleService;

  beforeEach(() => {
    prisma = createMockPrisma();
    cache = createMockCacheService();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    prisma.grade_scale.findUnique.mockResolvedValue(scaleRow());
    prisma.grade_scale.create.mockImplementation(async ({ data }) => ({
      id: 'gs-new',
      created_at: CREATED,
      updated_at: CREATED,
      ...data,
    }));
    prisma.grade_scale.update.mockImplementation(async ({ where, data }) => ({
      ...scaleRow({ id: where.id }),
      ...data,
    }));
    service = new GradeScaleService(prisma as any, cache as any);
  });

  describe('school resolution', () => {
    test('400 when the user has no school', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: null });
      const err = await expectRejection(service.list('u1'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe('User is not associated with a school');
    });

    test('a profile lookup failure is also a 400', async () => {
      prisma.user_profile.findUnique.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.getDefault('u1'));
      expect(err).toBeInstanceOf(BadRequestException);
    });
  });

  describe('list', () => {
    test('lists the school scales, default first then by name', async () => {
      prisma.grade_scale.findMany.mockResolvedValue([
        scaleRow({ id: 'gs-2', is_default: true, name: 'Default' }),
        scaleRow(),
      ]);
      const res = await service.list('u1');
      expect(res).toEqual([
        {
          id: 'gs-2',
          schoolId: 'school-1',
          name: 'Default',
          scaleType: 'letter',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: null,
        },
        {
          id: 'gs-1',
          schoolId: 'school-1',
          name: 'Letters',
          scaleType: 'letter',
          isDefault: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: null,
        },
      ]);
      const arg = prisma.grade_scale.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ school_id: 'school-1' });
      expect(arg.orderBy).toEqual([{ is_default: 'desc' }, { name: 'asc' }]);
      expect(res[0]).not.toHaveProperty('bands');
    });

    test('a query failure is a 400', async () => {
      prisma.grade_scale.findMany.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.list('u1'));
      expect((err as Error).message).toBe('Failed to list grade scales');
    });
  });

  describe('get', () => {
    test('returns the scale with bands converted to numbers, sorted by sort_order', async () => {
      prisma.grade_scale_band.findMany.mockResolvedValue([
        {
          id: 'b1',
          grade_scale_id: 'gs-1',
          label: 'A',
          min_percentage: new Prisma.Decimal('90.00'),
          max_percentage: new Prisma.Decimal('100.00'),
          gpa_points: new Prisma.Decimal('4.0'),
          is_pass: true,
          sort_order: 0,
        },
        {
          id: 'b2',
          grade_scale_id: 'gs-1',
          label: 'F',
          min_percentage: 0,
          max_percentage: 49.99,
          gpa_points: null,
          is_pass: false,
          sort_order: 1,
        },
      ]);
      const res = await service.get('gs-1', 'u1');
      expect(res.id).toBe('gs-1');
      expect(res.bands).toEqual([
        {
          id: 'b1',
          label: 'A',
          minPercentage: 90,
          maxPercentage: 100,
          gpaPoints: 4,
          isPass: true,
          sortOrder: 0,
        },
        {
          id: 'b2',
          label: 'F',
          minPercentage: 0,
          maxPercentage: 49.99,
          gpaPoints: null,
          isPass: false,
          sortOrder: 1,
        },
      ]);
      expect(prisma.grade_scale_band.findMany.mock.calls[0][0]).toEqual({
        where: { grade_scale_id: 'gs-1' },
        orderBy: { sort_order: 'asc' },
      });
    });

    test('404 when the scale does not exist', async () => {
      prisma.grade_scale.findUnique.mockResolvedValue(null);
      const err = await expectRejection(service.get('gs-x', 'u1'));
      expect(err).toBeInstanceOf(NotFoundException);
    });

    test('404 (not 403) for a scale in another school', async () => {
      prisma.grade_scale.findUnique.mockResolvedValue(
        scaleRow({ school_id: 'school-2' }),
      );
      const err = await expectRejection(service.get('gs-1', 'u1'));
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as Error).message).toBe('Grade scale not found');
    });

    test('a scale lookup failure is a 400', async () => {
      prisma.grade_scale.findUnique.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.get('gs-1', 'u1'));
      expect((err as Error).message).toBe('Failed to load grade scale');
    });

    test('a band lookup failure is a 400', async () => {
      prisma.grade_scale_band.findMany.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.get('gs-1', 'u1'));
      expect((err as Error).message).toBe('Failed to load grade scale bands');
    });
  });

  describe('getDefault', () => {
    test('null when there is no default, and nothing is cached', async () => {
      expect(await service.getDefault('u1')).toBeNull();
      expect(prisma.grade_scale.findFirst.mock.calls[0][0].where).toEqual({
        school_id: 'school-1',
        is_default: true,
      });
      expect(cache._store.has(DEFAULT_KEY)).toBe(false);
    });

    test('loads and caches the default for 24 h', async () => {
      prisma.grade_scale.findFirst.mockResolvedValue(
        scaleRow({ is_default: true }),
      );
      const res = await service.getDefault('u1');
      expect(res?.isDefault).toBe(true);
      expect(res?.bands).toEqual([]);
      expect(cache._store.get(DEFAULT_KEY)).toEqual({
        value: res,
        ttl: 60 * 60 * 24,
      });
    });

    test('serves from the cache without hitting the database', async () => {
      const cached = { id: 'cached', bands: [] };
      cache._store.set(DEFAULT_KEY, { value: cached, ttl: 1 });
      expect(await service.getDefault('u1')).toBe(cached as any);
      expect(prisma.grade_scale.findFirst).not.toHaveBeenCalled();
    });

    test('a lookup failure is treated as no default', async () => {
      prisma.grade_scale.findFirst.mockRejectedValue(new Error('db'));
      expect(await service.getDefault('u1')).toBeNull();
    });
  });

  describe('band validation', () => {
    const create = (bands: BandInputDto[]) =>
      service.create('u1', { name: 'S', scaleType: 'letter', bands });

    test('min > max is a 400', async () => {
      const err = await expectRejection(create([band('A', 90, 80)]));
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe('Band "A" has min > max');
    });

    test('min == max is allowed', async () => {
      await create([band('P', 50, 50)]);
      expect(prisma.grade_scale_band.createMany).toHaveBeenCalled();
    });

    test('overlapping bands are a 400, regardless of input order', async () => {
      const err = await expectRejection(
        create([band('A', 90, 100), band('C', 60, 70), band('B', 70, 89)]),
      );
      expect((err as Error).message).toBe('Bands "C" and "B" overlap');
    });

    test('touching bands (max == next min) overlap', async () => {
      const err = await expectRejection(
        create([band('A', 90, 100), band('B', 80, 90)]),
      );
      expect((err as Error).message).toBe('Bands "B" and "A" overlap');
    });

    test('gaps between bands are allowed', async () => {
      await create([band('A', 90, 100), band('F', 0, 40)]);
      expect(prisma.grade_scale_band.createMany).toHaveBeenCalled();
    });

    test('duplicate labels are a 400', async () => {
      const err = await expectRejection(
        create([band('A', 90, 100), band('A', 0, 10)]),
      );
      expect((err as Error).message).toBe('Duplicate band label "A"');
    });

    test('labels are case-sensitive', async () => {
      await create([band('A', 90, 100), band('a', 0, 10)]);
      expect(prisma.grade_scale_band.createMany).toHaveBeenCalled();
    });

    test('validation runs before any database access', async () => {
      await expectRejection(create([band('A', 90, 80)]));
      expect(prisma.user_profile.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('replaceBands validates too', async () => {
      const err = await expectRejection(
        service.replaceBands('gs-1', 'u1', {
          bands: [band('A', 50, 100), band('B', 0, 60)],
        }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(prisma.grade_scale_band.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    test('creates the scale and its bands in one transaction', async () => {
      const res = await service.create('u1', {
        name: 'Letters',
        scaleType: 'letter',
        bands: [
          band('A', 90, 100, { gpaPoints: 4, sortOrder: 5 }),
          band('F', 0, 49),
        ],
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.grade_scale.create.mock.calls[0][0].data).toEqual({
        school_id: 'school-1',
        name: 'Letters',
        scale_type: 'letter',
        is_default: false,
        created_by: 'u1',
        updated_by: 'u1',
      });
      expect(prisma.grade_scale_band.createMany.mock.calls[0][0].data).toEqual([
        {
          grade_scale_id: 'gs-new',
          label: 'A',
          min_percentage: 90,
          max_percentage: 100,
          gpa_points: 4,
          is_pass: true,
          sort_order: 5,
        },
        {
          grade_scale_id: 'gs-new',
          label: 'F',
          min_percentage: 0,
          max_percentage: 49,
          gpa_points: null,
          is_pass: false,
          sort_order: 1,
        },
      ]);
      // Not a default: the existing default is left alone.
      expect(prisma.grade_scale.updateMany).not.toHaveBeenCalled();
      expect(res.id).toBe('gs-new');
      expect(res.isDefault).toBe(false);
    });

    test('isDefault clears the old default first', async () => {
      await service.create('u1', {
        name: 'New default',
        scaleType: 'gpa',
        isDefault: true,
        bands: ABC,
      });
      expect(prisma.grade_scale.updateMany.mock.calls[0][0]).toEqual({
        where: { school_id: 'school-1', is_default: true },
        data: { is_default: false },
      });
      expect(prisma.grade_scale.create.mock.calls[0][0].data.is_default).toBe(
        true,
      );
      const clearOrder = prisma.grade_scale.updateMany.mock.invocationCallOrder[0];
      const createOrder = prisma.grade_scale.create.mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(createOrder);
    });

    test('invalidates the default cache', async () => {
      cache._store.set(DEFAULT_KEY, { value: {}, ttl: 1 });
      await service.create('u1', { name: 'S', scaleType: 'letter', bands: ABC });
      expect(cache._store.has(DEFAULT_KEY)).toBe(false);
    });

    test('a unique violation on the scale is a 409 (second default)', async () => {
      prisma.grade_scale.create.mockRejectedValue(dup());
      const err = await expectRejection(
        service.create('u1', {
          name: 'S',
          scaleType: 'letter',
          isDefault: true,
          bands: ABC,
        }),
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect(prisma.grade_scale_band.createMany).not.toHaveBeenCalled();
    });

    test('another scale insert failure is a 400', async () => {
      prisma.grade_scale.create.mockRejectedValue(new Error('db'));
      const err = await expectRejection(
        service.create('u1', { name: 'S', scaleType: 'letter', bands: ABC }),
      );
      expect((err as Error).message).toBe('Failed to create grade scale');
    });

    test('a unique violation on the bands is a 409, and the cache is kept', async () => {
      cache._store.set(DEFAULT_KEY, { value: {}, ttl: 1 });
      prisma.grade_scale_band.createMany.mockRejectedValue(dup());
      const err = await expectRejection(
        service.create('u1', { name: 'S', scaleType: 'letter', bands: ABC }),
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toBe(
        'Band labels must be unique within a scale',
      );
      expect(cache._store.has(DEFAULT_KEY)).toBe(true);
    });

    test('another band insert failure is a 400', async () => {
      prisma.grade_scale_band.createMany.mockRejectedValue(new Error('db'));
      const err = await expectRejection(
        service.create('u1', { name: 'S', scaleType: 'letter', bands: ABC }),
      );
      expect((err as Error).message).toBe('Failed to insert bands');
    });

    test('a failure clearing the old default is a 400', async () => {
      prisma.grade_scale.updateMany.mockRejectedValue(new Error('db'));
      const err = await expectRejection(
        service.create('u1', {
          name: 'S',
          scaleType: 'letter',
          isDefault: true,
          bands: ABC,
        }),
      );
      expect((err as Error).message).toBe('Failed to update default scale');
      expect(prisma.grade_scale.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    test('renames and stamps updated_by/updated_at', async () => {
      const res = await service.update('gs-1', 'u1', { name: 'Renamed' });
      const arg = prisma.grade_scale.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'gs-1' });
      expect(arg.data.name).toBe('Renamed');
      expect(arg.data.updated_by).toBe('u1');
      expect(arg.data.updated_at).toBeInstanceOf(Date);
      expect(arg.data).not.toHaveProperty('is_default');
      expect(prisma.grade_scale.updateMany).not.toHaveBeenCalled();
      expect(res.name).toBe('Renamed');
    });

    test('isDefault: true on a non-default clears the old default first', async () => {
      await service.update('gs-1', 'u1', { isDefault: true });
      expect(prisma.grade_scale.updateMany.mock.calls[0][0].where).toEqual({
        school_id: 'school-1',
        is_default: true,
      });
      expect(prisma.grade_scale.update.mock.calls[0][0].data.is_default).toBe(
        true,
      );
    });

    test('isDefault: true on the current default changes nothing about default', async () => {
      prisma.grade_scale.findUnique.mockResolvedValue(
        scaleRow({ is_default: true }),
      );
      await service.update('gs-1', 'u1', { isDefault: true });
      expect(prisma.grade_scale.updateMany).not.toHaveBeenCalled();
      expect(prisma.grade_scale.update.mock.calls[0][0].data).not.toHaveProperty(
        'is_default',
      );
    });

    test('isDefault: false unsets the current default', async () => {
      prisma.grade_scale.findUnique.mockResolvedValue(
        scaleRow({ is_default: true }),
      );
      await service.update('gs-1', 'u1', { isDefault: false });
      expect(prisma.grade_scale.update.mock.calls[0][0].data.is_default).toBe(
        false,
      );
      expect(prisma.grade_scale.updateMany).not.toHaveBeenCalled();
    });

    test('isDefault: false on a non-default is a no-op for the flag', async () => {
      await service.update('gs-1', 'u1', { isDefault: false });
      expect(prisma.grade_scale.update.mock.calls[0][0].data).not.toHaveProperty(
        'is_default',
      );
    });

    test('404 for a scale in another school, nothing written', async () => {
      prisma.grade_scale.findUnique.mockResolvedValue(
        scaleRow({ school_id: 'school-2' }),
      );
      const err = await expectRejection(
        service.update('gs-1', 'u1', { name: 'x' }),
      );
      expect(err).toBeInstanceOf(NotFoundException);
      expect(prisma.grade_scale.update).not.toHaveBeenCalled();
    });

    test('a unique violation is a 409', async () => {
      prisma.grade_scale.update.mockRejectedValue(dup());
      const err = await expectRejection(
        service.update('gs-1', 'u1', { isDefault: true }),
      );
      expect(err).toBeInstanceOf(ConflictException);
    });

    test('another failure is a 400', async () => {
      prisma.grade_scale.update.mockRejectedValue(new Error('db'));
      const err = await expectRejection(
        service.update('gs-1', 'u1', { name: 'x' }),
      );
      expect((err as Error).message).toBe('Failed to update grade scale');
    });

    test('invalidates the default cache of the scale school', async () => {
      cache._store.set(DEFAULT_KEY, { value: {}, ttl: 1 });
      await service.update('gs-1', 'u1', { name: 'x' });
      expect(cache._store.has(DEFAULT_KEY)).toBe(false);
    });
  });

  describe('replaceBands', () => {
    test('deletes, reinserts and stamps the scale in one transaction', async () => {
      await service.replaceBands('gs-1', 'u1', { bands: ABC });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.grade_scale_band.deleteMany.mock.calls[0][0]).toEqual({
        where: { grade_scale_id: 'gs-1' },
      });
      const rows = prisma.grade_scale_band.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => [r.label, r.sort_order])).toEqual([
        ['A', 0],
        ['B', 1],
        ['F', 2],
      ]);
      expect(rows.every((r: any) => r.grade_scale_id === 'gs-1')).toBe(true);
      const stamp = prisma.grade_scale.updateMany.mock.calls[0][0];
      expect(stamp.where).toEqual({ id: 'gs-1' });
      expect(stamp.data.updated_by).toBe('u1');
      const del = prisma.grade_scale_band.deleteMany.mock.invocationCallOrder[0];
      const ins = prisma.grade_scale_band.createMany.mock.invocationCallOrder[0];
      expect(del).toBeLessThan(ins);
    });

    test('404 for another school scale, bands untouched', async () => {
      prisma.grade_scale.findUnique.mockResolvedValue(
        scaleRow({ school_id: 'school-2' }),
      );
      const err = await expectRejection(
        service.replaceBands('gs-1', 'u1', { bands: ABC }),
      );
      expect(err).toBeInstanceOf(NotFoundException);
      expect(prisma.grade_scale_band.deleteMany).not.toHaveBeenCalled();
    });

    test('a delete failure is a 400', async () => {
      prisma.grade_scale_band.deleteMany.mockRejectedValue(new Error('db'));
      const err = await expectRejection(
        service.replaceBands('gs-1', 'u1', { bands: ABC }),
      );
      expect((err as Error).message).toBe('Failed to replace bands');
      expect(prisma.grade_scale_band.createMany).not.toHaveBeenCalled();
    });

    test('an insert failure rejects the transaction and keeps the cache', async () => {
      cache._store.set(DEFAULT_KEY, { value: {}, ttl: 1 });
      prisma.grade_scale_band.createMany.mockRejectedValue(dup());
      const err = await expectRejection(
        service.replaceBands('gs-1', 'u1', { bands: ABC }),
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect(prisma.grade_scale.updateMany).not.toHaveBeenCalled();
      expect(cache._store.has(DEFAULT_KEY)).toBe(true);
    });

    test('success invalidates the default cache', async () => {
      cache._store.set(DEFAULT_KEY, { value: {}, ttl: 1 });
      await service.replaceBands('gs-1', 'u1', { bands: ABC });
      expect(cache._store.has(DEFAULT_KEY)).toBe(false);
    });
  });

  describe('setDefault', () => {
    test('already default: returns it without writing', async () => {
      prisma.grade_scale.findUnique.mockResolvedValue(
        scaleRow({ is_default: true }),
      );
      cache._store.set(DEFAULT_KEY, { value: {}, ttl: 1 });
      const res = await service.setDefault('gs-1', 'u1');
      expect(res.isDefault).toBe(true);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.grade_scale.update).not.toHaveBeenCalled();
      expect(cache._store.has(DEFAULT_KEY)).toBe(true);
    });

    test('clears the old default then sets this one', async () => {
      const res = await service.setDefault('gs-1', 'u1');
      expect(prisma.grade_scale.updateMany.mock.calls[0][0].where).toEqual({
        school_id: 'school-1',
        is_default: true,
      });
      const arg = prisma.grade_scale.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'gs-1' });
      expect(arg.data.is_default).toBe(true);
      expect(arg.data.updated_by).toBe('u1');
      expect(res.isDefault).toBe(true);
    });

    test('an update failure is a 400', async () => {
      prisma.grade_scale.update.mockRejectedValue(new Error('db'));
      const err = await expectRejection(service.setDefault('gs-1', 'u1'));
      expect((err as Error).message).toBe('Failed to set default scale');
    });

    test('invalidates the default cache', async () => {
      cache._store.set(DEFAULT_KEY, { value: {}, ttl: 1 });
      await service.setDefault('gs-1', 'u1');
      expect(cache._store.has(DEFAULT_KEY)).toBe(false);
    });

    test('404 for another school scale', async () => {
      prisma.grade_scale.findUnique.mockResolvedValue(
        scaleRow({ school_id: 'school-2' }),
      );
      expect(await expectRejection(service.setDefault('gs-1', 'u1'))).toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    test('deletes the scale and invalidates the cache', async () => {
      cache._store.set(DEFAULT_KEY, { value: {}, ttl: 1 });
      expect(await service.delete('gs-1', 'u1')).toEqual({
        message: 'Grade scale deleted',
      });
      expect(prisma.grade_scale.deleteMany.mock.calls[0][0]).toEqual({
        where: { id: 'gs-1' },
      });
      expect(cache._store.has(DEFAULT_KEY)).toBe(false);
    });

    test('404 for another school scale, nothing deleted', async () => {
      prisma.grade_scale.findUnique.mockResolvedValue(
        scaleRow({ school_id: 'school-2' }),
      );
      const err = await expectRejection(service.delete('gs-1', 'u1'));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(prisma.grade_scale.deleteMany).not.toHaveBeenCalled();
    });

    test('a delete failure is a 400', async () => {
      prisma.grade_scale.deleteMany.mockRejectedValue(new Error('fk'));
      const err = await expectRejection(service.delete('gs-1', 'u1'));
      expect((err as Error).message).toBe('Failed to delete grade scale');
    });
  });
});
