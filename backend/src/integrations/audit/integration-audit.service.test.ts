import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { createMockPrisma } from '@/test/prisma-mock';
import { IntegrationAuditService } from './integration-audit.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';

describe('IntegrationAuditService', () => {
  test('writes entries in the caller transaction and drops any secret-looking key', async () => {
    const prisma = createMockPrisma();
    const tx = createMockPrisma();
    await new IntegrationAuditService(prisma as any).record(tx as any, SCHOOL, { id: 'u-1', via: 'school_admin' }, [
      {
        action: 'secret_rotated',
        webhookId: 'h-1',
        webhook: 'SIS',
        changes: { secret: 'whsec_leak', secret_enc: 'v1:x', note: 'kept' },
      },
    ]);
    expect(prisma.integration_audit_log.createMany).not.toHaveBeenCalled();
    const row = tx.integration_audit_log.createMany.mock.calls[0][0].data[0];
    expect(row).toMatchObject({ school_id: SCHOOL, actor_id: 'u-1', actor_via: 'school_admin', action: 'secret_rotated' });
    expect(row.changes).toEqual({ note: 'kept' });
  });

  test('lists newest first with the actor, capped at 200, and refuses a foreign cursor', async () => {
    const prisma = createMockPrisma();
    prisma.integration_audit_log.findMany.mockResolvedValue([
      { id: 'a', created_at: new Date('2026-11-04T00:00:00Z'), action: 'webhook_created', webhook_id: 'h', webhook: 'SIS', actor_id: 'u-1', actor_via: 'organisation_admin', changes: {} },
    ]);
    prisma.user_profile.findMany.mockResolvedValue([{ id: 'u-1', first_name: 'Grace', last_name: 'Hopper', email: null, app_user: { email: 'g@x.edu' } }]);
    const svc = new IntegrationAuditService(prisma as any);
    const items = await svc.list(SCHOOL, { limit: 999 });
    expect(prisma.integration_audit_log.findMany.mock.calls[0][0].take).toBe(200);
    expect(items[0].actor).toEqual({ id: 'u-1', name: 'Grace Hopper', email: 'g@x.edu' });
    await expect(svc.list(SCHOOL, { before: '33333333-3333-4333-8333-333333333333' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
