import { describe, expect, test } from 'bun:test';
import { createMockCacheService } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { AuthService } from './auth.service';

/** Sign-in failures are logged with the address masked (j***@domain), never in full. */
describe('AuthService log lines', () => {
  function build(emailCodes: Record<string, unknown>) {
    const prisma = createMockPrisma();
    const service = new AuthService(
      prisma as any,
      createMockCacheService() as any,
      { ssoRequirement: async () => null } as any,
      emailCodes as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const lines: string[] = [];
    (service as any).logger = {
      error: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      log: (m: string) => lines.push(m),
    };
    return { service, lines };
  }

  test('a failed send', async () => {
    const { service, lines } = build({ send: async () => { throw new Error('smtp down'); } });
    await expect(service.sendOtp('jo.smith@school.edu')).rejects.toThrow();
    expect(lines.join('\n')).toContain('j***@school.edu');
    expect(lines.join('\n')).not.toContain('jo.smith');
  });

  test('a failed verification', async () => {
    const { service, lines } = build({ verify: async () => { throw new Error('Invalid or expired code'); } });
    await expect(
      service.verifyOtp('jo.smith@school.edu', '12345678', { ip: '1.2.3.4', headers: {} } as any, {} as any),
    ).rejects.toThrow();
    expect(lines.join('\n')).toContain('j***@school.edu');
    expect(lines.join('\n')).not.toContain('jo.smith');
  });
});
