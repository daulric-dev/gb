import { describe, expect, mock, test } from 'bun:test';
import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { AdminGuard } from '@/auth/admin.guard';
import { STEP_UP_KEY, StepUpGuard } from '@/auth/step-up.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { FEATURE_KEY } from '@/features/require-feature.decorator';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { SchoolWebhookController, WebhookEventTypesController } from './school-webhook.controller';
import { OrganisationWebhookController } from './organisation-webhook.controller';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const HOOK = '22222222-2222-4222-8222-222222222222';

/** Handlers that change configuration need step-up; reads, test and redeliver do not. */
const CONFIG = ['create', 'update', 'remove', 'rotate'];
const NO_STEP_UP = ['list', 'auditLog', 'get', 'delivery', 'deliveries', 'test', 'redeliver'];

describe.each([
  ['school admin', SchoolWebhookController],
  ['organisation console', OrganisationWebhookController],
])('%s webhook routes', (_label, controller: any) => {
  const proto = controller.prototype;

  test('config changes need step-up; everything else does not', () => {
    for (const m of CONFIG) {
      expect({ m, stepUp: !!Reflect.getMetadata(STEP_UP_KEY, proto[m]) }).toEqual({ m, stepUp: true });
      expect(Reflect.getMetadata(GUARDS_METADATA, proto[m])).toContain(StepUpGuard);
    }
    for (const m of NO_STEP_UP) {
      expect({ m, stepUp: !!Reflect.getMetadata(STEP_UP_KEY, proto[m]) }).toEqual({ m, stepUp: false });
    }
  });

  test('every route needs the integrations feature', () => {
    expect(Reflect.getMetadata(FEATURE_KEY, controller)).toEqual(['integrations']);
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(FeatureGuard);
  });

  test('lists use HTTP QUERY', () => {
    for (const m of ['auditLog', 'deliveries']) {
      expect(Reflect.getMetadata(METHOD_METADATA, proto[m])).toBe(Reflect.getMetadata(METHOD_METADATA, proto.auditLog));
    }
    expect(Reflect.getMetadata(METHOD_METADATA, proto.auditLog)).not.toBe(Reflect.getMetadata(METHOD_METADATA, proto.list));
  });
});

describe('who may use them', () => {
  test('school routes: school:update and the school admin role', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SchoolWebhookController);
    expect(guards).toContain(AdminGuard);
    for (const m of [...CONFIG, ...NO_STEP_UP]) {
      expect(Reflect.getMetadata(PERMISSION_KEY, SchoolWebhookController.prototype[m as keyof SchoolWebhookController])).toBe('school:update');
    }
  });

  test('organisation routes: organisation admins, any school; an unknown school is 404', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OrganisationWebhookController)).toContain(OrganisationAdminGuard);
    const webhooks = { list: mock(async () => []), get: mock(async () => ({})) };
    const organisation = {
      requireSchool: mock(async (id: string) => {
        if (id !== SCHOOL) throw new NotFoundException('School not found');
      }),
    };
    const c = new OrganisationWebhookController(webhooks as any, {} as any, organisation as any);
    await c.list(SCHOOL);
    expect(webhooks.list).toHaveBeenCalledWith(SCHOOL);
    expect(await expectRejection(c.get('33333333-3333-4333-8333-333333333333', HOOK))).toBeInstanceOf(NotFoundException);
  });

  test("the school admin's routes act on their own active school only", async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
    const webhooks = { get: mock(async () => ({})) };
    const c = new SchoolWebhookController(webhooks as any, {} as any, prisma as any);
    await c.get({ user: { id: 'u-1' } }, HOOK);
    expect(webhooks.get).toHaveBeenCalledWith(SCHOOL, HOOK);
  });

  test('integrations off for the school: FeatureGuard answers 403 FEATURE_DISABLED', async () => {
    const prisma = createMockPrisma();
    prisma.organisation.findFirst.mockResolvedValue({ features: {} }); // default: off
    prisma.school.findUnique.mockResolvedValue({ disabled_features: [] });
    const guard = new FeatureGuard(new Reflector(), new FeatureService(prisma as any, createMockCacheService() as any), prisma as any);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u-1' }, params: { schoolId: SCHOOL } }) }),
      getHandler: () => OrganisationWebhookController.prototype.list,
      getClass: () => OrganisationWebhookController,
    } as unknown as ExecutionContext;
    const err = await expectRejection(guard.canActivate(ctx));
    expect(err).toBeInstanceOf(FeatureDisabledException);

    prisma.organisation.findFirst.mockResolvedValue({ features: { integrations: true } });
    const on = new FeatureGuard(new Reflector(), new FeatureService(prisma as any, createMockCacheService() as any), prisma as any);
    expect(await on.canActivate(ctx)).toBe(true);
  });

  test('the event type catalog is for school admins and organisation admins', async () => {
    const prisma = createMockPrisma();
    const c = new WebhookEventTypesController(prisma as any);
    expect(await expectRejection(c.eventTypes({ user: { id: 'teacher' } }))).toBeInstanceOf(ForbiddenException);
    prisma.school_management.findFirst.mockResolvedValue({ id: 'm' });
    const catalog = await c.eventTypes({ user: { id: 'head' } });
    expect(catalog.eventTypes.length).toBeGreaterThan(10);
    expect(Reflect.getMetadata(FEATURE_KEY, WebhookEventTypesController)).toBeUndefined();
  });
});
