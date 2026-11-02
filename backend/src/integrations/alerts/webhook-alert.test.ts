import { describe, expect, mock, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { WebhookAlertService } from './webhook-alert.service';
import { webhookDisabledEmail } from './webhook-alert.email';

const SCHOOL = '11111111-1111-4111-8111-111111111111';

describe('webhook switched-off alert', () => {
  test('mails the school admin and organisation admins with the right links', async () => {
    process.env.FRONTEND_URL = 'https://gb.test';
    const prisma = createMockPrisma();
    prisma.school.findUnique.mockResolvedValue({ name: 'Riverside' });
    const mail = { configured: () => true, send: mock(async () => {}) };
    const sso = {
      recipients: async () => [
        { email: 'head@riverside.edu', orgAdmin: false },
        { email: 'it@org.edu', orgAdmin: true },
      ],
    };
    await new WebhookAlertService(prisma as any, mail as any, sso as any).autoDisabled(SCHOOL, { id: 'h', name: 'SIS' }, 50);
    const sent = mail.send.mock.calls.map((c: any[]) => c[0]);
    expect(sent.map((m: any) => m.to)).toEqual(['head@riverside.edu', 'it@org.edu']);
    expect(sent[0].subject).toBe('Webhook "SIS" was switched off for Riverside');
    expect(sent[0].text).toContain('/dashboard/settings#integrations');
    expect(sent[1].text).toContain(`/organisation/schools/${SCHOOL}#integrations`);
    expect(sent[0].text).toContain('50 failed deliveries');
  });

  test('without SMTP, or when sending fails, nothing throws', async () => {
    const prisma = createMockPrisma();
    const quiet = { configured: () => false, send: mock(async () => {}) };
    await new WebhookAlertService(prisma as any, quiet as any, {} as any).autoDisabled(SCHOOL, { id: 'h', name: 'SIS' }, 3);
    expect(quiet.send).not.toHaveBeenCalled();
    const broken = { configured: () => true, send: mock(async () => { throw new Error('smtp'); }) };
    const sso = { recipients: async () => [{ email: 'a@b.c', orgAdmin: false }] };
    await new WebhookAlertService(prisma as any, broken as any, sso as any).autoDisabled(SCHOOL, { id: 'h', name: 'SIS' }, 3);
  });

  test('the email escapes names', () => {
    const m = webhookDisabledEmail({ school: 'A&B', webhook: '<x>', failures: 5, at: new Date(), settingsUrl: 'https://gb.test' });
    expect(m.html).not.toContain('<x>');
  });
});
