import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { createMockPrisma } from '@/test/prisma-mock';
import { AuditLogService, auditChanges } from './audit-log.service';

function auditService(prisma: ReturnType<typeof createMockPrisma>) {
  const cache = {
    delete: async () => {},
    deleteByPrefix: async () => {},
  };
  return new AuditLogService(prisma as never, cache as never);
}

describe('AuditLogService', () => {
  test('records value changes and redacts sensitive fields', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      app_user: { email: 'ada@example.test' },
    } as never);
    const service = auditService(prisma);

    await service.record(
      prisma as never,
      'school-1',
      { id: 'actor-1' },
      {
        entity: 'school',
        entityId: 'school-1',
        action: 'update',
        changes: {
          name: { before: 'Old name', after: 'New name' },
          password: { before: 'old-password', after: 'new-password' },
          amount: {
            before: new Prisma.Decimal('12.50'),
            after: new Prisma.Decimal('13.25'),
          },
        },
      },
    );

    expect(prisma.audit_log.create.mock.calls[0][0].data).toMatchObject({
      school_id: 'school-1',
      actor_id: 'actor-1',
      actor_name: 'Ada Lovelace',
      actor_email: 'ada@example.test',
      entity: 'school',
      action: 'update',
      changes: {
        name: { before: 'Old name', after: 'New name' },
        password: { before: '[redacted]', after: '[redacted]' },
        amount: { before: '12.5', after: '13.25' },
      },
    });
  });

  test('queues opt-in school webhook deliveries with redacted audit values in the transaction', async () => {
    const prisma = createMockPrisma();
    const auditId = '00000000-0000-4000-8000-000000000001';
    const schoolId = '00000000-0000-4000-8000-000000000002';
    const actorId = '00000000-0000-4000-8000-000000000003';
    prisma.school.findUnique.mockResolvedValue({
      name: 'Example School',
      disabled_feature_rows: [],
    } as never);
    prisma.organisation.findFirst.mockResolvedValue({
      features: { integrations: true },
    } as never);
    prisma.user_profile.findUnique.mockResolvedValue({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      app_user: { email: 'ada@example.test' },
    } as never);
    prisma.school_webhook.findMany.mockResolvedValue([
      { id: 'hook-1' },
    ] as never);
    prisma.audit_log.create.mockResolvedValue({
      id: auditId,
      entity: 'term',
      entity_id: 'term-1',
      created_at: new Date('2026-11-04T09:15:00Z'),
      changes: {
        name: { before: 'Old term', after: 'New term' },
        password: { before: '[redacted]', after: '[redacted]' },
      },
    } as never);
    const service = auditService(prisma);

    await service.record(
      prisma as never,
      schoolId,
      { id: actorId },
      {
        entity: 'term',
        entityId: 'term-1',
        action: 'update',
        changes: {
          name: { before: 'Old term', after: 'New term' },
          password: { before: 'old', after: 'new' },
        },
      },
    );

    expect(prisma.school_webhook.findMany).toHaveBeenCalledWith({
      where: {
        school_id: schoolId,
        enabled: true,
        event_subscriptions: { some: { event_type: 'audit.changed' } },
      },
      select: { id: true },
    });
    expect(prisma.webhook_delivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          webhook_id: 'hook-1',
          school_id: schoolId,
          event_id: auditId,
          event_type: 'audit.changed',
          status: 'pending',
          payload: {
            event_type: 'audit.changed',
            message: 'Ada Lovelace updated term in Example School',
            data: {
              school: { id: schoolId, name: 'Example School' },
              audit: {
                id: auditId,
                entity: 'term',
                entityId: 'term-1',
                action: 'update',
                actor: {
                  id: actorId,
                  name: 'Ada Lovelace',
                  email: 'ada@example.test',
                },
                changes: {
                  name: { before: 'Old term', after: 'New term' },
                  password: {
                    before: '[redacted]',
                    after: '[redacted]',
                  },
                },
                createdAt: '2026-11-04T09:15:00.000Z',
              },
            },
          },
        }),
      ],
    });
  });

  test('does not enqueue when school integrations are off or the entry is organisation-wide', async () => {
    const prisma = createMockPrisma();
    prisma.school.findUnique.mockResolvedValue({
      name: 'Example School',
      disabled_feature_rows: [],
    } as never);
    prisma.organisation.findFirst.mockResolvedValue({
      features: { integrations: false },
    } as never);
    const service = auditService(prisma);
    const entry = {
      entity: 'school',
      entityId: 'school-1',
      action: 'update' as const,
      changes: { name: { before: 'Old', after: 'New' } },
    };

    await service.record(prisma as never, 'school-1', { id: 'actor-1' }, entry);
    await service.record(prisma as never, null, { id: 'actor-1' }, entry);

    expect(prisma.school_webhook.findMany).not.toHaveBeenCalled();
    expect(prisma.webhook_delivery.createMany).not.toHaveBeenCalled();
  });

  test('creates diffs only for changed fields', () => {
    expect(
      auditChanges(
        { name: 'Course', description: null },
        { name: 'New course', description: null },
      ),
    ).toEqual({ name: { before: 'Course', after: 'New course' } });
  });

  test('reverts a term update only while its audited after-value is still current', async () => {
    const prisma = createMockPrisma();
    const auditId = '00000000-0000-4000-8000-000000000001';
    const schoolId = '00000000-0000-4000-8000-000000000002';
    const term = {
      id: '00000000-0000-4000-8000-000000000003',
      academic_year_id: '00000000-0000-4000-8000-000000000004',
      name: 'Spring',
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-03-01T00:00:00.000Z'),
      sort_order: 1,
    };
    prisma.audit_log.findUnique.mockResolvedValue({
      id: auditId,
      scope: 'school',
      school_id: schoolId,
      entity: 'term',
      entity_id: term.id,
      action: 'update',
      changes: { name: { before: 'Winter', after: 'Spring' } },
    } as never);
    prisma.term.findFirst.mockResolvedValue(term as never);
    prisma.term.updateMany.mockResolvedValue({ count: 1 } as never);
    const service = auditService(prisma);

    await service.revert(auditId, {
      id: '00000000-0000-4000-8000-000000000005',
    });

    expect(prisma.term.updateMany).toHaveBeenCalledWith({
      where: { id: term.id, name: 'Spring' },
      data: { name: 'Winter' },
    });
    expect(prisma.audit_log.create.mock.calls[0][0].data).toMatchObject({
      entity: 'term',
      entity_id: term.id,
      action: 'update',
      changes: { name: { before: 'Spring', after: 'Winter' } },
    });
  });

  test('refuses to revert a term update after a later change', async () => {
    const prisma = createMockPrisma();
    const auditId = '00000000-0000-4000-8000-000000000001';
    const termId = '00000000-0000-4000-8000-000000000003';
    prisma.audit_log.findUnique.mockResolvedValue({
      id: auditId,
      scope: 'school',
      school_id: '00000000-0000-4000-8000-000000000002',
      entity: 'term',
      entity_id: termId,
      action: 'update',
      changes: { name: { before: 'Winter', after: 'Spring' } },
    } as never);
    prisma.term.findFirst.mockResolvedValue({
      id: termId,
      academic_year_id: '00000000-0000-4000-8000-000000000004',
      name: 'Summer',
    } as never);
    const service = auditService(prisma);

    await expect(
      service.revert(auditId, { id: '00000000-0000-4000-8000-000000000005' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.term.updateMany).not.toHaveBeenCalled();
  });

  test('refuses to restore deleted records without a complete restore handler', async () => {
    const prisma = createMockPrisma();
    const auditId = '00000000-0000-4000-8000-000000000001';
    prisma.audit_log.findUnique.mockResolvedValue({
      id: auditId,
      scope: 'school',
      school_id: '00000000-0000-4000-8000-000000000002',
      entity: 'term',
      entity_id: '00000000-0000-4000-8000-000000000003',
      action: 'delete',
      changes: { name: { before: 'Spring', after: null } },
    } as never);
    const service = auditService(prisma);

    await expect(
      service.revert(auditId, { id: '00000000-0000-4000-8000-000000000005' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.term.deleteMany).not.toHaveBeenCalled();
  });

  test('reverses a term creation by deleting the unchanged record', async () => {
    const prisma = createMockPrisma();
    const auditId = '00000000-0000-4000-8000-000000000001';
    const termId = '00000000-0000-4000-8000-000000000003';
    prisma.audit_log.findUnique.mockResolvedValue({
      id: auditId,
      scope: 'school',
      school_id: '00000000-0000-4000-8000-000000000002',
      entity: 'term',
      entity_id: termId,
      action: 'create',
      changes: {
        academic_year_id: {
          before: null,
          after: '00000000-0000-4000-8000-000000000004',
        },
        name: { before: null, after: 'Spring' },
        start_date: {
          before: null,
          after: '2026-01-01T00:00:00.000Z',
        },
        end_date: {
          before: null,
          after: '2026-03-01T00:00:00.000Z',
        },
        sort_order: { before: null, after: 1 },
      },
    } as never);
    prisma.term.findFirst.mockResolvedValue({
      id: termId,
      academic_year_id: '00000000-0000-4000-8000-000000000004',
      name: 'Spring',
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-03-01T00:00:00.000Z'),
      sort_order: 1,
    } as never);
    prisma.term.deleteMany.mockResolvedValue({ count: 1 } as never);
    const service = auditService(prisma);

    await service.revert(auditId, {
      id: '00000000-0000-4000-8000-000000000005',
    });

    expect(prisma.term.deleteMany).toHaveBeenCalledWith({
      where: {
        id: termId,
        academic_year_id: '00000000-0000-4000-8000-000000000004',
        name: 'Spring',
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-03-01T00:00:00.000Z'),
        sort_order: 1,
      },
    });
    expect(prisma.audit_log.create.mock.calls[0][0].data).toMatchObject({
      entity: 'term',
      entity_id: termId,
      action: 'delete',
    });
  });

  test('lists a school-scoped page newest-first with a continuation cursor', async () => {
    const prisma = createMockPrisma();
    const id = '00000000-0000-4000-8000-000000000001';
    prisma.audit_log.findMany.mockResolvedValue([
      {
        id,
        school_id: 'school-1',
        school: { id: 'school-1', name: 'Example School' },
        actor_id: 'actor-1',
        actor_name: 'Ada Lovelace',
        actor_email: 'ada@example.test',
        entity: 'term',
        entity_id: 'term-1',
        action: 'update',
        changes: { name: { before: 'Old', after: 'New' } },
        created_at: new Date('2026-11-04T12:00:00Z'),
      },
    ] as never);
    const service = auditService(prisma);

    const page = await service.list({ schoolId: 'school-1', limit: 1 });

    expect(page.items[0]).toMatchObject({
      schoolName: 'Example School',
      actor: { id: 'actor-1', name: 'Ada Lovelace' },
      entity: 'term',
    });
    expect(page.nextCursor).toBe(id);
    expect(prisma.audit_log.findMany.mock.calls[0][0]).toMatchObject({
      where: { school_id: 'school-1' },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 1,
    });
  });

  test('rejects malformed pagination cursors', async () => {
    const prisma = createMockPrisma();
    const service = auditService(prisma);

    await expect(service.list({ before: 'not-a-uuid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.audit_log.findFirst).not.toHaveBeenCalled();
  });

  test('surfaces audit-log query failures as server errors', async () => {
    const prisma = createMockPrisma();
    prisma.audit_log.findMany.mockRejectedValue(new Error('database error'));
    const service = auditService(prisma);

    await expect(service.list()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
