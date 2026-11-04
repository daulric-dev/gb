import { describe, expect, mock, test } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('AuthController session revocation', () => {
  test('refuses to revoke others if the current session is missing', async () => {
    const sessions = { revokeOthers: mock(async () => 2) };
    const controller = new AuthController(
      {} as never,
      {} as never,
      sessions as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.revokeOtherSessions({ user: { id: 'user-1' } }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.revokeOthers).not.toHaveBeenCalled();
  });

  test('keeps the authenticated session and revokes the other sessions', async () => {
    const sessions = { revokeOthers: mock(async () => 2) };
    const controller = new AuthController(
      {} as never,
      {} as never,
      sessions as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.revokeOtherSessions({
        user: { id: 'user-1', sessionId: 'session-current' },
      }),
    ).resolves.toEqual({ revoked: 2 });
    expect(sessions.revokeOthers).toHaveBeenCalledWith(
      'user-1',
      'session-current',
    );
  });
});
