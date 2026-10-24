import { describe, expect, test } from 'bun:test';
import { createMockPrisma } from './prisma-mock';

describe('createMockPrisma', () => {
  test('models default to empty results and record calls', async () => {
    const prisma = createMockPrisma();
    expect(await prisma.course.findUnique({ where: { id: 'x' } })).toBeNull();
    expect(await prisma.course.findMany({})).toEqual([]);
    expect(await prisma.course_student.count({})).toBe(0);
    expect(prisma.course.findUnique.mock.calls[0][0]).toEqual({ where: { id: 'x' } });
  });

  test('results can be set per method', async () => {
    const prisma = createMockPrisma();
    prisma.course.findUnique.mockResolvedValue({ id: 'c1' });
    expect(await prisma.course.findUnique({})).toEqual({ id: 'c1' });
    expect(prisma.course).toBe(prisma.course);
  });

  test('$transaction runs callbacks and arrays', async () => {
    const prisma = createMockPrisma();
    prisma.course.create.mockResolvedValue({ id: 'c1' });
    const viaCallback = await prisma.$transaction(async (tx: any) => tx.course.create({}));
    const viaArray = await prisma.$transaction([prisma.course.count({}), prisma.course.create({})]);
    expect(viaCallback).toEqual({ id: 'c1' });
    expect(viaArray).toEqual([0, { id: 'c1' }]);
  });
});
