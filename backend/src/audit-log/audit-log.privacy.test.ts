import { describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import {
  AuditLogService,
  csvRecordCount,
  PRIVATE_AUDIT_ENTITIES,
  webhookChanges,
} from './audit-log.service';

function withHooks() {
  const prisma = createMockPrisma();
  prisma.school.findUnique.mockResolvedValue({ name: 'A', disabled_feature_rows: [] });
  prisma.organisation.findFirst.mockResolvedValue({ features: { integrations: true } });
  prisma.school_webhook.findMany.mockResolvedValue([{ id: 'hook' }]);
  prisma.audit_log.create.mockImplementation(async ({ data }: any) => ({ id: 'a1', created_at: new Date(), ...data }));
  return { prisma, svc: new AuditLogService(prisma as any, createMockCacheService() as any) };
}

describe('csvRecordCount', () => {
  test('counts data rows, not the header, and a quoted line break is one row', () => {
    expect(csvRecordCount('a,b\r\n')).toBe(0);
    expect(csvRecordCount('a,b\r\n1,2\r\n3,4\r\n')).toBe(2);
    expect(csvRecordCount('a,b\n"line one\nline two",2\n')).toBe(1);
    expect(csvRecordCount('a\n1')).toBe(1);
    expect(csvRecordCount('')).toBe(0);
  });
});

describe('webhook privacy', () => {
  test('accommodations are private entities', () => {
    expect(PRIVATE_AUDIT_ENTITIES.has('activity_accommodation')).toBe(true);
    expect(PRIVATE_AUDIT_ENTITIES.has('student_accommodation')).toBe(true);
  });

  test('student webhooks carry names and enrolment, never gender or date of birth', () => {
    const changes = {
      first_name: { before: 'A', after: 'B' },
      gender: { before: 'f', after: 'm' },
      date_of_birth: { before: null, after: '2010-01-01' },
    };
    expect(webhookChanges('student', changes)).toEqual({ first_name: { before: 'A', after: 'B' } });
    expect(webhookChanges('term', changes)).toEqual(changes);
  });

  test('a student update queues a webhook without the special fields; the log keeps them', async () => {
    const { prisma, svc } = withHooks();
    await svc.record(prisma as any, 's1', { id: 'u' }, {
      entity: 'student',
      entityId: 'st',
      action: 'update',
      changes: { gender: { before: 'f', after: 'm' }, is_active: { before: true, after: false } },
    });
    expect(prisma.audit_log.create.mock.calls[0][0].data.changes.gender).toBeDefined();
    const payload = prisma.webhook_delivery.createMany.mock.calls[0][0].data[0].payload;
    expect(JSON.stringify(payload)).not.toContain('gender');
    expect(JSON.stringify(payload)).toContain('is_active');
  });

  test('exports are recorded with scope and row count, and never sent to webhooks', async () => {
    const { prisma, svc } = withHooks();
    prisma.course.findUnique.mockResolvedValue({ school_id: 's1' });
    await svc.recordExport('u', { courseId: 'c1', entity: 'gradebook', scope: 'course', csv: 'h\r\n1\r\n2\r\n' });
    const row = prisma.audit_log.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ school_id: 's1', entity: 'gradebook', entity_id: 'c1', action: 'export' });
    expect(row.changes).toEqual({ scope: { before: null, after: 'course' }, rows: { before: null, after: 2 } });
    expect(prisma.webhook_delivery.createMany).not.toHaveBeenCalled();
  });
});
