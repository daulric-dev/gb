import { describe, expect, mock, test } from 'bun:test';
import { MailService, redactEmail, stripEmails } from './mail.service';

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

describe('SMTP errors', () => {
  test('a failed send is rethrown with addresses redacted, keeping the SMTP code', async () => {
    const { service, sendMail } = build();
    sendMail.mockImplementation(async () => {
      const err = Object.assign(new Error('550 5.1.1 <jane.doe@school.example>: Recipient address rejected'), {
        code: 'EENVELOPE',
        responseCode: 550,
      });
      throw err;
    });
    let caught: any;
    try {
      await service.send({ to: 'jane.doe@school.example', subject: 's', text: 't' });
    } catch (e) {
      caught = e;
    }
    expect(caught.message).not.toContain('jane.doe@');
    expect(caught.message).toContain('j***@school.example');
    expect(caught.code).toBe('EENVELOPE');
    expect(caught.responseCode).toBe(550);
  });

  test('stripEmails redacts every address in text', () => {
    expect(stripEmails('to a.b@x.org and c@y.co.uk failed')).toBe('to a***@x.org and c***@y.co.uk failed');
  });

  test('stripEmails redacts addresses whose domain ends in digits or hyphens', () => {
    // An internationalised domain ends in punycode, which has digits and
    // hyphens in its last label. Requiring that label to be letters would
    // leave the whole address in the log. Redacting up to the last usable
    // label keeps the address hidden; the tail after it is not an address.
    expect(stripEmails('bounced for user@example.xn--p1ai')).toBe(
      'bounced for u***@example.xn--p1ai',
    );
    expect(stripEmails('a@x.org1')).toBe('a***@x.org1');
    expect(stripEmails('user@mail.example.c0m')).toBe('u***@mail.example.c0m');
    expect(stripEmails('a@b.co.2x')).toBe('a***@b.co.2x');
  });

  test('stripEmails leaves text that is not an address alone', () => {
    for (const text of [
      'no address here',
      '@handle at the start',
      'a@b (no dot in the domain)',
      'a@b.c (one-letter top level)',
      'a@b.12 (digits for a top level)',
      '@ on its own',
      '',
    ]) {
      expect(stripEmails(text)).toBe(text);
    }
  });

  test('stripEmails trims trailing punctuation off the domain', () => {
    expect(stripEmails('bounced for a@x.org.')).toBe('bounced for a***@x.org.');
    expect(stripEmails('<a@x.org>')).toBe('<a***@x.org>');
  });

  test('stripEmails handles addresses that run together', () => {
    expect(stripEmails('a@x.org,b@y.org')).toBe('a***@x.org,b***@y.org');
  });

  test('stripEmails stays fast on input built to make a pattern backtrack', () => {
    // The shape that made the old pattern polynomial: a long run of labels
    // with nothing valid at the end. Linear scanning does not care, so this
    // finishes immediately; a backtracking matcher would not.
    const nasty = `a@${'b.'.repeat(5000)}!`;
    const started = Date.now();
    expect(stripEmails(nasty)).toBe(nasty);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
