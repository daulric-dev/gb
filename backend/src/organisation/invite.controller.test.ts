import { describe, expect, mock, test } from 'bun:test';
import { InviteController } from './invite.controller';

describe('InviteController', () => {
  const invites = {
    list: mock(async () => []),
    revoke: mock(async () => ({ revoked: true })),
    resend: mock(async () => ({ id: 'i', email: 'a@x.org', expiresAt: 'x' })),
  };
  const controller = new InviteController(invites as any);
  const req = { user: { id: 'u-me' } };

  test('lists every open invite, or one kind', async () => {
    await controller.list({});
    await controller.list({ kind: 'organisation_admin' });
    expect(invites.list.mock.calls).toEqual([[undefined], ['organisation_admin']] as any);
  });

  test('revoke and resend act as the caller', async () => {
    await controller.revoke(req, 'i-1');
    await controller.resend(req, 'i-1');
    expect(invites.revoke).toHaveBeenCalledWith('u-me', 'i-1');
    expect(invites.resend).toHaveBeenCalledWith('u-me', 'i-1');
  });
});
