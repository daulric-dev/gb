import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { createMockPrisma } from '@/test/prisma-mock';
import { AuditLogService, auditChanges } from './audit-log.service';

describe('AuditLogService', () => {
  test('records value changes and redacts sensitive fields', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      app_user: { email: 'ada@example.test' },
    } as never);
    const service = new AuditLogService(prisma as never);

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

  test('creates diffs only for changed fields', () => {
    expect(
      auditChanges(
        { name: 'Course', description: null },
        { name: 'New course', description: null },
      ),
    ).toEqual({ name: { before: 'Course', after: 'New course' } });
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
    const service = new AuditLogService(prisma as never);

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
    const service = new AuditLogService(prisma as never);

    await expect(service.list({ before: 'not-a-uuid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.audit_log.findFirst).not.toHaveBeenCalled();
  });

  test('surfaces audit-log query failures as server errors', async () => {
    const prisma = createMockPrisma();
    prisma.audit_log.findMany.mockRejectedValue(new Error('database error'));
    const service = new AuditLogService(prisma as never);

    await expect(service.list()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
