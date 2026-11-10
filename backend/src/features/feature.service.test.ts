import { beforeEach, describe, expect, test } from 'bun:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FeatureService } from './feature.service';
import { FEATURES } from './feature.catalog';
import { FeatureDisabledException } from './feature-disabled.exception';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

describe('FeatureService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let service: FeatureService;
  let orgFeatures: Record<string, unknown>;
  let disabled: Record<string, string[]>;

  beforeEach(() => {
    prisma = createMockPrisma();
    cache = createMockCacheService();
    orgFeatures = {};
    disabled = { 's-1': [] };
    prisma.organisation.findFirst.mockImplementation(async () => ({
      id: 'org-1',
      features: orgFeatures,
    }));
    prisma.organisation.update.mockImplementation(async ({ data }) => {
      orgFeatures = data.features;
      return {};
    });
    prisma.school.findUnique.mockImplementation(async ({ where }) =>
      where.id in disabled ? { disabled_features: disabled[where.id] } : null,
    );
    prisma.school.update.mockImplementation(async ({ where, data }) => {
      disabled[where.id] = data.disabled_features;
      return {};
    });
    service = new FeatureService(prisma as any, cache as any);
  });

  test('effective: org defaults with no school, narrowed by the school', async () => {
    orgFeatures = { student_messaging: true };
    disabled['s-1'] = ['calendar'];
    const org = await service.effective(null);
    expect(org.calendar).toBe(true);
    expect(org.student_messaging).toBe(true);
    const school = await service.effective('s-1');
    expect(school.calendar).toBe(false);
    expect(await service.isEnabled('s-1', 'student_messaging')).toBe(true);
  });

  test('before setup (no organisation row) every default applies', async () => {
    prisma.organisation.findFirst.mockResolvedValue(null);
    const eff = await service.effective(null);
    expect(eff.messaging).toBe(true);
    expect(eff.chat_channels).toBe(false);
  });

  test('assertEnabled throws the FEATURE_DISABLED body', async () => {
    disabled['s-1'] = ['attendance'];
    const err: any = await expectRejection(service.assertEnabled('s-1', 'attendance'));
    expect(err).toBeInstanceOf(FeatureDisabledException);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toEqual({
      statusCode: 403,
      code: 'FEATURE_DISABLED',
      feature: 'attendance',
      message: 'Attendance is turned off for your school',
    });
  });

  test('lookups are cached until a change invalidates them', async () => {
    await service.effective('s-1');
    await service.effective('s-1');
    expect(prisma.organisation.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.school.findUnique).toHaveBeenCalledTimes(1);

    await cache.set('profile:u1', { id: 'u1' }, 60);
    await service.updateSchoolFeatures('s-1', { calendar: false });
    expect(await cache.get('profile:u1')).toBeNull();
    expect((await service.effective('s-1')).calendar).toBe(false);
  });

  describe('organisation', () => {
    test('lists every feature with its setting, default and requirements', async () => {
      orgFeatures = { calendar: false };
      const rows = await service.organisationFeatures();
      expect(rows).toHaveLength(FEATURES.length);
      expect(rows.find((r) => r.key === 'calendar')).toMatchObject({
        enabled: false,
        default: true,
        requires: [],
      });
      expect(rows.find((r) => r.key === 'student_messaging')).toEqual({
        key: 'student_messaging',
        label: 'Students can message their teachers',
        description: expect.any(String),
        enabled: false,
        default: false,
        requires: ['messaging'],
      });
    });

    test('PATCH merges overrides and drops unknown stored keys', async () => {
      orgFeatures = { calendar: false, legacy: true };
      const rows = await service.updateOrganisationFeatures({ student_messaging: true });
      expect(orgFeatures).toEqual({ calendar: false, student_messaging: true });
      expect(rows.find((r) => r.key === 'student_messaging')?.enabled).toBe(true);
      expect((await service.effective(null)).student_messaging).toBe(true);
    });

    test('PATCH: 400 for an unknown key or a non-boolean', async () => {
      const unknown = await expectRejection(
        service.updateOrganisationFeatures({ billing: true }),
      );
      expect(unknown).toBeInstanceOf(BadRequestException);
      expect((unknown as Error).message).toBe('Unknown feature: billing');
      const notBool = await expectRejection(
        service.updateOrganisationFeatures({ calendar: 'off' }),
      );
      expect(notBool).toBeInstanceOf(BadRequestException);
      expect(prisma.organisation.update).not.toHaveBeenCalled();
    });

    test('PATCH before setup is a 404', async () => {
      prisma.organisation.findFirst.mockResolvedValue(null);
      const err = await expectRejection(
        service.updateOrganisationFeatures({ calendar: false }),
      );
      expect(err).toBeInstanceOf(NotFoundException);
    });
  });

  describe('school', () => {
    test('lists availability, the school switch and the effective value', async () => {
      orgFeatures = { messaging: false, student_messaging: true };
      disabled['s-1'] = ['calendar'];
      const rows = await service.schoolFeatures('s-1');
      const by = Object.fromEntries(rows.map((r) => [r.key, r]));
      expect(by.calendar).toMatchObject({
        availableInOrganisation: true,
        enabledForSchool: false,
        effective: false,
      });
      expect(by.student_messaging).toMatchObject({
        availableInOrganisation: false,
        enabledForSchool: true,
        effective: false,
        requires: ['messaging'],
      });
      expect(by.files.effective).toBe(true);
    });

    test('a school can switch an allowed feature off and back on', async () => {
      await service.updateSchoolFeatures('s-1', { attendance: false, files: false });
      expect(disabled['s-1']).toEqual(['attendance', 'files']);
      const rows = await service.updateSchoolFeatures('s-1', { files: true });
      expect(disabled['s-1']).toEqual(['attendance']);
      expect(rows.find((r) => r.key === 'files')?.effective).toBe(true);
    });

    test('a school can never switch on what the organisation turned off', async () => {
      orgFeatures = { calendar: false };
      const err = await expectRejection(
        service.updateSchoolFeatures('s-1', { calendar: true }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe('Calendar is turned off for your organisation');
      // student_messaging is off by default for the organisation.
      const def = await expectRejection(
        service.updateSchoolFeatures('s-1', { student_messaging: true }),
      );
      expect((def as Error).message).toBe(
        'Students can message their teachers is turned off for your organisation',
      );
      expect(prisma.school.update).not.toHaveBeenCalled();
    });

    test('switching off is always allowed, unknown keys are a 400', async () => {
      orgFeatures = { calendar: false };
      await service.updateSchoolFeatures('s-1', { calendar: false });
      expect(disabled['s-1']).toEqual(['calendar']);
      const err = await expectRejection(
        service.updateSchoolFeatures('s-1', { nope: false }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
    });
  });

  test('schoolOfUser: active school, else a student record', async () => {
    prisma.user_profile.findUnique.mockResolvedValueOnce({
      school_id: 's-1',
      account_type: 'staff',
    });
    expect(await service.schoolOfUser('u1')).toBe('s-1');
    prisma.user_profile.findUnique.mockResolvedValueOnce({
      school_id: null,
      account_type: 'student',
    });
    prisma.student.findFirst.mockResolvedValueOnce({ school_id: 's-2' });
    expect(await service.schoolOfUser('u2')).toBe('s-2');
  });
});
