import { describe, expect, mock, test } from 'bun:test';
import { MailService, redactEmail } from './mail.service';

function build() {
  const service = new MailService();
  const sendMail = mock(async (_m: unknown) => ({}));
  (service as any).transporter = { sendMail };
  const logs: string[] = [];
  (service as any).logger = { log: (m: string) => logs.push(m), warn: () => undefined };
  return { service, sendMail, logs };
}

describe('MailService logging', () => {
  test('logs the kind and a masked recipient, never the subject; kind is not sent', async () => {
    const { service, sendMail, logs } = build();
    await service.send({
      to: 'parent@example.com',
      subject: 'Ann Lee was absent from Maths',
      text: 't',
      kind: 'parent_notice',
    });
    expect(logs).toEqual(['Sent parent_notice email to p***@example.com']);
    expect(logs.join()).not.toContain('Ann');
    const sent = sendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.kind).toBeUndefined();
    expect(sent.subject).toBe('Ann Lee was absent from Maths');
  });

  test("a message without a kind logs 'unknown'; odd characters are dropped", async () => {
    const { service, logs } = build();
    await service.send({ to: 'a@b.org', subject: 'Secret', text: 't' });
    await service.send({ to: 'a@b.org', subject: 'Secret', text: 't', kind: 'x\ny "z"' });
    expect(logs).toEqual(['Sent unknown email to a***@b.org', 'Sent xyz email to a***@b.org']);
  });

  test('redactEmail keeps the first letter and the domain', () => {
    expect(redactEmail('jo.smith@school.edu')).toBe('j***@school.edu');
    expect(redactEmail(null)).toBe('***@');
  });
});
