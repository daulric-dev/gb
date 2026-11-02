import { afterEach, describe, expect, mock, test } from 'bun:test';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { EmailDomainController } from '@/email-domain/email-domain.controller';
import { SchoolController } from '@/school/school.controller';
import { SignInController } from '@/organisation/sign-in.controller';
import { STEP_UP_KEY, STEP_UP_REQUIRED, StepUpGuard } from './step-up.guard';
import { StepUpService } from './step-up.service';
import { StepUpController } from './step-up.controller';

const ctx = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

describe('StepUpGuard', () => {
  const guard = new StepUpGuard();

  test('lets an elevated session through', () => {
    expect(guard.canActivate(ctx({ id: 'u', sessionId: 's', elevatedUntil: Date.now() + 60_000 }))).toBe(true);
  });

  test('403 STEP_UP_REQUIRED when not elevated, or the window has passed', () => {
    for (const user of [
      { id: 'u', sessionId: 's', elevatedUntil: null },
      { id: 'u', sessionId: 's', elevatedUntil: Date.now() - 1 },
      { id: 'u', elevatedUntil: Date.now() + 60_000 }, // no session
      undefined,
    ]) {
      let err: unknown;
      try {
        guard.canActivate(ctx(user));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        code: STEP_UP_REQUIRED,
        message: "Confirm it's you to change single sign-on or integration settings.",
      });
    }
  });
});

/** `METHOD path` of each handler on a controller that requires step-up. */
function routes(controller: any): { route: string; stepUp: boolean }[] {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((n) => n !== 'constructor')
    .map((n) => {
      const h = controller.prototype[n];
      const method = Reflect.getMetadata(METHOD_METADATA, h);
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, h) ?? [];
      const stepUp = !!Reflect.getMetadata(STEP_UP_KEY, h);
      if (stepUp) expect(guards).toContain(StepUpGuard);
      return { route: `${RequestMethod[method]} ${n}`, stepUp };
    });
}

describe('@RequireStepUp placement', () => {
  test('every school-admin SSO write needs it; reads do not', () => {
    const r = routes(EmailDomainController);
    expect(r.filter((x) => x.stepUp).map((x) => x.route).sort()).toEqual(
      ['POST add', 'PATCH update', 'DELETE remove', 'POST verify'].sort(),
    );
    expect(r.find((x) => x.route === 'GET list')!.stepUp).toBe(false);

    const s = routes(SchoolController).filter((x) => x.stepUp).map((x) => x.route);
    expect(s).toEqual(['PUT updateSsoProvider']);
    const proto = SchoolController.prototype as any;
    expect(Reflect.getMetadata(STEP_UP_KEY, proto.getSsoProviders)).toBeUndefined();
    expect(Reflect.getMetadata(STEP_UP_KEY, proto.getSsoAudit)).toBeUndefined();
  });

  test('every organisation-console SSO write needs it; reads do not', () => {
    const r = routes(SignInController);
    expect(r.filter((x) => x.stepUp).map((x) => x.route).sort()).toEqual(
      [
        'PUT updateSchoolProvider',
        'POST addSchoolDomain',
        'PATCH updateSchoolDomain',
        'DELETE removeSchoolDomain',
        'POST verifySchoolDomain',
      ].sort(),
    );
    // Reads: GET, and QUERY for the audit log.
    expect(r.filter((x) => !x.stepUp).every((x) => /^(GET|QUERY) /.test(x.route))).toBe(true);
  });
});

describe('StepUpService', () => {
  function build() {
    const codes = {
      send: mock(async () => {}),
      verify: mock(async (email: string) => email),
      issue: mock(async () => '12345678'),
    };
    const until = new Date('2026-11-02T10:10:00Z');
    const sessions = { elevate: mock(async () => until) };
    const service = new StepUpService(codes as any, sessions as any);
    return { service, codes, sessions, until };
  }
  const user = { id: 'u1', email: 'jo@school.edu', sessionId: 's1' };

  afterEach(() => {
    delete process.env.ALLOW_DEV_LOGIN;
    process.env.NODE_ENV = 'test';
  });

  test("send mails a step-up code to the signed-in user's own address", async () => {
    const { service, codes } = build();
    expect(await service.send(user, '1.2.3.4')).toEqual({ sent: true });
    expect(codes.send.mock.calls[0]).toEqual(['jo@school.edu', '1.2.3.4', 'step_up'] as any);
  });

  test('verify checks a step-up code and elevates only this session', async () => {
    const { service, codes, sessions, until } = build();
    expect(await service.verify(user, '12345678', '1.2.3.4')).toEqual({ elevatedUntil: until.toISOString() });
    expect(codes.verify.mock.calls[0]).toEqual(['jo@school.edu', '12345678', '1.2.3.4', 'step_up'] as any);
    expect(sessions.elevate.mock.calls[0]).toEqual(['s1'] as any);
  });

  test('a wrong code is a 400 (the session is fine) and elevates nothing', async () => {
    const { service, codes, sessions } = build();
    codes.verify.mockImplementation(async () => {
      throw new UnauthorizedException('Invalid or expired code');
    });
    await expect(service.verify(user, '00000000')).rejects.toThrow(BadRequestException);
    expect(sessions.elevate).not.toHaveBeenCalled();
  });

  test('without a session there is nothing to elevate', async () => {
    const { service } = build();
    await expect(service.send({ id: 'u1', email: 'jo@school.edu' })).rejects.toThrow(UnauthorizedException);
  });

  test('the dev code endpoint is dev-only, like dev sign-in codes', async () => {
    const { service, codes } = build();
    await expect(service.devCode(user)).rejects.toThrow(NotFoundException);
    process.env.ALLOW_DEV_LOGIN = 'true';
    process.env.NODE_ENV = 'production';
    await expect(service.devCode(user)).rejects.toThrow(NotFoundException);
    process.env.NODE_ENV = 'development';
    expect(await service.devCode(user)).toEqual({ code: '12345678' });
    expect(codes.issue.mock.calls[0]).toEqual(['jo@school.edu', undefined, 'step_up'] as any);
  });

  test('the controller passes the session user and client address, never a body email', async () => {
    const { service, codes } = build();
    const c = new StepUpController(service);
    await c.send({ user, ip: '9.9.9.9' });
    expect((codes.send.mock.calls[0] as any[])[0]).toBe('jo@school.edu');
  });
});
