import { beforeEach, describe, expect, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { createMockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';
import { StudentReportsService } from './student-reports.service';
import { signReportLink } from './report-link';

const DOC = '00000000-0000-4000-8000-000000000001';
const SCHOOL = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
});

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate key', {
    code: 'P2002',
    clientVersion: 'test',
  });

/** The service with only what openSignedLink touches. */
function makeService(prisma: ReturnType<typeof createMockPrisma>) {
  const features = { assertEnabled: async () => {} } as any;
  const storage = {
    get: async () => ({ body: null, contentType: 'application/pdf', size: 1 }),
  } as any;
  const data = {} as any;
  return new StudentReportsService(prisma as any, storage, data, features);
}

describe('openSignedLink: single use', () => {
  test('spends the link before reading anything', async () => {
    const prisma = createMockPrisma();
    // The read after the claim is irrelevant here; fail it so the test only
    // proves the claim happened, and happened first.
    prisma.report_document.findFirst.mockResolvedValue(null);
    const svc = makeService(prisma);
    const { token } = signReportLink(DOC, SCHOOL);

    await expectRejection(svc.openSignedLink(token));

    expect(prisma.report_link_use.create).toHaveBeenCalledTimes(1);
    const data = prisma.report_link_use.create.mock.calls[0][0].data;
    expect(data.jti).toBeString();
    expect(data.expires_at).toBeInstanceOf(Date);
  });

  test('a second use is a 404, not a download', async () => {
    const prisma = createMockPrisma();
    prisma.report_link_use.create.mockRejectedValue(uniqueViolation());
    const svc = makeService(prisma);
    const { token } = signReportLink(DOC, SCHOOL);

    const err = await expectRejection(svc.openSignedLink(token));
    expect(err).toBeInstanceOf(NotFoundException);
    // Nothing was read: the link was spent.
    expect(prisma.report_document.findFirst).not.toHaveBeenCalled();
  });

  test('a database outage is not reported as a spent link', async () => {
    const prisma = createMockPrisma();
    prisma.report_link_use.create.mockRejectedValue(new Error('connection refused'));
    const svc = makeService(prisma);
    const { token } = signReportLink(DOC, SCHOOL);

    const err = await expectRejection(svc.openSignedLink(token));
    expect(err).not.toBeInstanceOf(NotFoundException);
    expect((err as Error).message).toBe('connection refused');
  });

  test('an invalid token never touches the database', async () => {
    const prisma = createMockPrisma();
    const svc = makeService(prisma);

    const err = await expectRejection(svc.openSignedLink('not-a-token'));
    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.report_link_use.create).not.toHaveBeenCalled();
  });
});
