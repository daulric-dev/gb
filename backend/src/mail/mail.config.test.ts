import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mailFrom, smtpOptions } from './mail.config';

describe('smtpOptions', () => {
  test('nothing configured is null', () => {
    expect(smtpOptions({})).toBeNull();
  });

  test('SMTP_URL is passed through and wins over fields', () => {
    expect(
      smtpOptions({ SMTP_URL: 'smtp://127.0.0.1:1025', SMTP_HOST: 'x' }),
    ).toBe('smtp://127.0.0.1:1025');
  });

  test('gmail preset: implicit TLS on 465 and the app password spaces removed', () => {
    expect(
      smtpOptions({
        SMTP_SERVICE: 'Gmail',
        SMTP_USER: 'office@school.edu',
        SMTP_PASSWORD: 'abcd efgh ijkl mnop',
      }),
    ).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: 'office@school.edu', pass: 'abcdefghijklmnop' },
    });
  });

  test('outlook preset uses STARTTLS and requires it', () => {
    const o = smtpOptions({
      SMTP_SERVICE: 'outlook',
      SMTP_USER: 'a@b.c',
      SMTP_PASSWORD: 'p w',
    }) as any;
    expect(o).toMatchObject({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      requireTLS: true,
    });
    // Only providers that print grouped app passwords get spaces stripped.
    expect(o.auth.pass).toBe('p w');
  });

  test('custom host, special characters need no encoding', () => {
    const o = smtpOptions({
      SMTP_HOST: 'mail.school.edu',
      SMTP_PORT: '2525',
      SMTP_USER: 'u',
      SMTP_PASSWORD: 'p@ss:/word#?',
    }) as any;
    expect(o).toMatchObject({
      host: 'mail.school.edu',
      port: 2525,
      secure: false,
    });
    expect(o.auth.pass).toBe('p@ss:/word#?');
  });

  test('SMTP_SECURE overrides the port default', () => {
    expect(
      (
        smtpOptions({
          SMTP_HOST: 'h',
          SMTP_PORT: '465',
          SMTP_SECURE: 'false',
        }) as any
      ).secure,
    ).toBe(false);
  });

  test('no credentials means no auth and no forced TLS', () => {
    expect(smtpOptions({ SMTP_HOST: 'localhost', SMTP_PORT: '1025' })).toEqual({
      host: 'localhost',
      port: 1025,
      secure: false,
      requireTLS: false,
    });
  });

  test('password from a mounted secret file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smtp-'));
    const file = join(dir, 'pass');
    writeFileSync(file, 'abcd efgh ijkl mnop\n');
    const o = smtpOptions({
      SMTP_SERVICE: 'gmail',
      SMTP_USER: 'u@x.y',
      SMTP_PASSWORD_FILE: file,
    }) as any;
    expect(o.auth.pass).toBe('abcdefghijklmnop');
  });

  test('unknown service and bad port are clear errors', () => {
    expect(() => smtpOptions({ SMTP_SERVICE: 'hotmailz' })).toThrow(
      /Unknown SMTP_SERVICE/,
    );
    expect(() => smtpOptions({ SMTP_HOST: 'h', SMTP_PORT: 'abc' })).toThrow(
      /not a valid port/,
    );
  });
});

describe('mailFrom', () => {
  test('MAIL_FROM wins, else the SMTP user, else a placeholder', () => {
    expect(mailFrom({ MAIL_FROM: 'X <x@y.z>', SMTP_USER: 'a@b.c' })).toBe(
      'X <x@y.z>',
    );
    expect(mailFrom({ SMTP_USER: 'office@school.edu' })).toBe(
      'GradeBook <office@school.edu>',
    );
    expect(mailFrom({})).toBe('GradeBook <no-reply@localhost>');
  });
});
