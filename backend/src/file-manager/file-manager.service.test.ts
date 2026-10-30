import { Readable } from 'node:stream';
import { describe, test, expect, mock } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  FileManagerService,
  MAX_PENDING_UPLOADS,
} from './file-manager.service';
import { ObjectTooLargeError } from '@/storage/storage.service';
import { ByteBudget } from '@/storage/byte-budget';
import { FileListFilter } from './dto/list-files.filter';
import { expectRejection } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { MB } from './upload-limit.config';

const USER = 'user-1';
const FILE_ID = '00000000-0000-4000-8000-0000000000f1';

function fileRow(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'f1',
    school_id: 'school-1',
    owner_id: USER,
    name: 'doc.pdf',
    bucket: 'file-manager',
    storage_path: 's/p',
    content_type: 'application/pdf',
    size_bytes: BigInt(10),
    source: 'upload',
    source_ref: null,
    status: 'ready',
    scan_detail: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

/** Access stub: resolves principals once, no shared ids, no download grants. */
function accessStub(over: Partial<Record<string, any>> = {}) {
  return {
    principalsFor: () =>
      Promise.resolve({ userId: USER, roleIds: [], courseIds: [] }),
    sharedFileIdsFor: () => Promise.resolve(over.sharedIds ?? []),
    downloadFlagsFor: () =>
      Promise.resolve(over.downloadFlags ?? new Map<string, boolean>()),
  };
}

/**
 * `rows` is what file queries return: an array for lists, a single row for
 * lookups. `count` is the total a paginated list reports.
 */
/** A StorageService stand-in holding at most one object. */
function storageStub(object: Buffer | null = null, size?: number) {
  return {
    uploadUrl: mock((key: string, type: string) =>
      Promise.resolve(`https://s3.test/gradebook/${key}?type=${type}`),
    ),
    exists: mock(() =>
      Promise.resolve(
        object ? { size: size ?? object.byteLength, contentType: null } : null,
      ),
    ),
    getBuffer: mock(() => Promise.resolve(object)),
    get: mock(() =>
      Promise.resolve(
        object
          ? { body: Readable.from([object]), contentType: null, size: object.byteLength }
          : null,
      ),
    ),
    put: mock(() => Promise.resolve()),
    copy: mock(() => Promise.resolve()),
    delete: mock(() => Promise.resolve()),
  };
}

/** UploadLimitService stand-in: every school gets `schoolMb`, ceiling `maxMb`. */
function limitsStub(schoolMb = 100, maxMb = 100) {
  return {
    config: { maxMb, defaultMb: 100 },
    bytesForSchool: mock((_schoolId: string) =>
      Promise.resolve(Math.min(schoolMb, maxMb) * MB),
    ),
  };
}

function makeService(
  fileResult: { rows: any; count?: number },
  access = accessStub(),
  storage = storageStub(),
  budget = new ByteBudget(1024 * 1024),
  limits = limitsStub(),
) {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
  const list = Array.isArray(fileResult.rows) ? fileResult.rows : [];
  const one = Array.isArray(fileResult.rows) ? null : fileResult.rows;
  prisma.file.findMany.mockResolvedValue(list);
  prisma.file.count.mockResolvedValue(fileResult.count ?? list.length);
  prisma.file.findFirst.mockResolvedValue(one);
  prisma.file.findUnique.mockResolvedValue(one);
  const chatSystem = { notifyFileShares: () => Promise.resolve() };
  const folders = {
    getOwned: () => Promise.resolve({ id: 'folder-1', owner_id: USER }),
  };
  const svc = new FileManagerService(
    storage as any,
    prisma as any,
    access as any,
    {} as any,
    chatSystem as any,
    folders as any,
    createMockErasureLog() as any,
    budget,
    limits as any,
  );
  return { svc, prisma, storage, budget, limits };
}

describe('list', () => {
  test('returns a bare array when unpaginated and marks owner files downloadable', async () => {
    const { svc } = makeService({
      rows: [fileRow({ id: 'a' }), fileRow({ id: 'b' })],
    });
    const out = await svc.list(USER, FileListFilter.Own);
    expect(Array.isArray(out)).toBe(true);
    const arr = out as any[];
    expect(arr).toHaveLength(2);
    expect(arr.every((f) => f.canDownload === true)).toBe(true);
    // bigint column comes back as a plain JSON number.
    expect(arr[0].sizeBytes).toBe(10);
  });

  test('short-circuits to empty when nothing is shared', async () => {
    const { svc } = makeService({ rows: [] }, accessStub({ sharedIds: [] }));
    const out = await svc.list(USER, FileListFilter.Shared);
    expect(out).toEqual([]);
  });

  test('resolves download rights from the batched flag map for shared files', async () => {
    const { svc } = makeService(
      { rows: [fileRow({ id: 'x', owner_id: 'other' })] },
      accessStub({
        sharedIds: ['x'],
        downloadFlags: new Map([['x', true]]),
      }),
    );
    const out = (await svc.list(USER, FileListFilter.Shared)) as any[];
    expect(out).toHaveLength(1);
    expect(out[0].canDownload).toBe(true);
  });

  test('returns a paginated envelope when a page is requested', async () => {
    const { svc } = makeService({
      rows: [fileRow({ id: 'a' }), fileRow({ id: 'b' })],
      count: 5,
    });
    const out = (await svc.list(USER, FileListFilter.Own, {
      page: 1,
      pageSize: 2,
    })) as any;
    expect(out.data).toHaveLength(2);
    expect(out.data[0].createdAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(out.meta).toMatchObject({
      total: 5,
      page: 1,
      pageSize: 2,
      pageCount: 3,
      hasMore: true,
    });
  });
});

describe('ownership guard', () => {
  test('rename on a file the user does not own throws Forbidden', async () => {
    const { svc } = makeService({
      rows: fileRow({ owner_id: 'someone-else' }),
    });
    const err = await expectRejection(svc.rename(USER, FILE_ID, 'new'));
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('a malformed file id is not found, as before', async () => {
    const { svc, prisma } = makeService({ rows: fileRow() });
    const err = await expectRejection(svc.rename(USER, 'not-a-uuid', 'x'));
    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.file.findFirst).not.toHaveBeenCalled();
  });
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

describe('direct uploads', () => {
  test('a ticket is a presigned PUT for the reserved object', async () => {
    const { svc, prisma } = makeService({ rows: null });
    const t = await svc.createUploadTicket(USER, {
      name: 'Essay.pdf',
      sizeBytes: 100,
      contentType: 'application/pdf',
    });
    const row = prisma.file.create.mock.calls[0][0].data;
    expect(row.status).toBe('pending');
    expect(t).toMatchObject({
      fileId: row.id,
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      contentType: 'application/pdf',
      maxBytes: 100 * 1024 * 1024,
    });
    expect(t.uploadUrl).toContain(`file-manager/${row.storage_path}`);
    expect(typeof t.expiresAt).toBe('string');
  });

  test('a ticket for a disallowed type or size is refused', async () => {
    const { svc } = makeService({ rows: null });
    for (const input of [
      { name: 'a.exe', sizeBytes: 10, contentType: 'application/x-msdownload' },
      { name: 'a.pdf', sizeBytes: 101 * 1024 * 1024, contentType: 'application/pdf' },
    ]) {
      expect(await expectRejection(svc.createUploadTicket(USER, input))).toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  test("a ticket above the school's limit names that limit", async () => {
    const { svc, prisma } = makeService(
      { rows: null },
      accessStub(),
      storageStub(),
      new ByteBudget(1024 * 1024),
      limitsStub(10),
    );
    const err = await expectRejection(
      svc.createUploadTicket(USER, {
        name: 'a.pdf',
        sizeBytes: 10 * MB + 1,
        contentType: 'application/pdf',
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain("school's limit is 10MB");
    expect(prisma.file.create).not.toHaveBeenCalled();
  });

  test('a school set to 100MB takes a 100MB file, and the ticket says so', async () => {
    const { svc } = makeService(
      { rows: null },
      accessStub(),
      storageStub(),
      new ByteBudget(256 * MB),
    );
    const t = await svc.createUploadTicket(USER, {
      name: 'big.pdf',
      sizeBytes: 100 * MB,
      contentType: 'application/pdf',
    });
    expect(t.maxBytes).toBe(100 * MB);
  });

  test('a checked type cannot be bigger than the verify budget', async () => {
    const { svc } = makeService(
      { rows: null },
      accessStub(),
      storageStub(),
      new ByteBudget(50 * MB),
    );
    const err = await expectRejection(
      svc.createUploadTicket(USER, {
        name: 'big.pdf',
        sizeBytes: 60 * MB,
        contentType: 'application/pdf',
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('at most 50MB');
  });

  test('an unchecked type may use the whole school limit', async () => {
    const { svc } = makeService(
      { rows: null },
      accessStub(),
      storageStub(),
      new ByteBudget(1 * MB),
    );
    const t = await svc.createSubmissionUploadTicket(USER, {
      name: 'project.zip',
      sizeBytes: 90 * MB,
      contentType: 'application/zip',
    });
    expect(t.maxBytes).toBe(100 * MB);
  });

  test('a ticket for a 10MB school reports 10MB as maxBytes', async () => {
    const { svc } = makeService(
      { rows: null },
      accessStub(),
      storageStub(),
      new ByteBudget(1024 * 1024),
      limitsStub(10),
    );
    const t = await svc.createUploadTicket(USER, {
      name: 'a.pdf',
      sizeBytes: 100,
      contentType: 'application/pdf',
    });
    expect(t.maxBytes).toBe(10 * MB);
  });

  test("a submission ticket is held to the course's school, when given", async () => {
    const { svc, limits } = makeService({ rows: null });
    await svc.createSubmissionUploadTicket(
      USER,
      { name: 'a.pdf', sizeBytes: 100, contentType: 'application/pdf' },
      'course-school',
    );
    expect(limits.bytesForSchool).toHaveBeenCalledWith('course-school');
  });

  test('submission upload tickets accept a programming-language MIME type', async () => {
    const { svc, prisma } = makeService({ rows: null });
    const ticket = await svc.createSubmissionUploadTicket(USER, {
      name: 'solution.py',
      sizeBytes: 100,
      contentType: 'Text/X-Python; charset=utf-8',
    });

    expect(ticket.contentType).toBe('text/x-python');
    expect(prisma.file.create.mock.calls[0][0].data.content_type).toBe(
      'text/x-python',
    );
  });

  test('completing marks the file ready when the bytes check out', async () => {
    const { svc, prisma } = makeService(
      { rows: fileRow({ status: 'pending', size_bytes: BigInt(PDF.byteLength) }) },
      accessStub(),
      storageStub(PDF),
    );
    prisma.file.update.mockImplementation(async ({ data }) =>
      fileRow({ ...data }),
    );
    const out = await svc.finaliseUpload(USER, FILE_ID);
    expect(out.status).toBe('ready');
    expect(prisma.file.update.mock.calls[0][0].data.size_bytes).toBe(
      PDF.byteLength,
    );
  });

  test('submission uploads accept unrecognized but valid binary file types', async () => {
    const source = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const storage = storageStub(source);
    const { svc, prisma } = makeService(
      {
        rows: fileRow({
          status: 'pending',
          content_type: 'application/x-rust-source',
          size_bytes: BigInt(source.byteLength),
          storage_path: 'uploads/school-1/user-1/f1-main.rs',
        }),
      },
      accessStub(),
      storage,
    );
    prisma.file.update.mockImplementation(async ({ data }) =>
      fileRow({ ...data, content_type: 'application/x-rust-source' }),
    );

    const result = await svc.finaliseSubmissionUpload(USER, FILE_ID);

    expect(result.status).toBe('ready');
    // Bytes of an unchecked type are never read: the store copies them.
    expect(storage.getBuffer).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.copy).toHaveBeenCalledWith(
      'file-manager/uploads/school-1/user-1/f1-main.rs',
      'file-manager/school-1/user-1/f1-main.rs',
      'application/x-rust-source',
    );
    expect(storage.delete).toHaveBeenCalledWith(
      'file-manager/uploads/school-1/user-1/f1-main.rs',
    );
    expect(prisma.file.update.mock.calls[0][0].data.size_bytes).toBe(
      source.byteLength,
    );
  });

  test('an unchecked type still has its size checked before the copy', async () => {
    const storage = storageStub(Buffer.alloc(4), 9);
    const { svc } = makeService(
      {
        rows: fileRow({
          status: 'pending',
          content_type: 'application/x-rust-source',
          size_bytes: BigInt(4),
          storage_path: 'uploads/school-1/user-1/f1-main.rs',
        }),
      },
      accessStub(),
      storage,
    );
    const err = await expectRejection(svc.finaliseSubmissionUpload(USER, FILE_ID));
    expect((err as Error).message).toBe(
      'The uploaded file does not match the declared size',
    );
    expect(storage.copy).not.toHaveBeenCalled();
  });

  test('a checked type holds verify budget while reading and releases it', async () => {
    const storage = storageStub(PDF);
    const budget = new ByteBudget(1024 * 1024);
    let heldDuringRead = 0;
    storage.getBuffer.mockImplementation(() => {
      heldDuringRead = budget.inUse;
      return Promise.resolve(PDF);
    });
    const { svc, prisma } = makeService(
      { rows: fileRow({ status: 'pending', size_bytes: BigInt(PDF.byteLength) }) },
      accessStub(),
      storage,
      budget,
    );
    prisma.file.update.mockImplementation(async ({ data }) => fileRow({ ...data }));
    await svc.finaliseUpload(USER, FILE_ID);
    expect(heldDuringRead).toBe(PDF.byteLength);
    expect(budget.inUse).toBe(0);
  });

  test('verify budget is released when the check fails', async () => {
    const html = Buffer.from('<html></html>');
    const budget = new ByteBudget(1024 * 1024);
    const { svc } = makeService(
      { rows: fileRow({ status: 'pending', size_bytes: null }) },
      accessStub(),
      storageStub(html),
      budget,
    );
    await expectRejection(svc.finaliseUpload(USER, FILE_ID));
    expect(budget.inUse).toBe(0);
  });

  test('verify budget is released when the read throws', async () => {
    const storage = storageStub(PDF);
    storage.getBuffer.mockImplementation(() => Promise.reject(new Error('reset')));
    const budget = new ByteBudget(1024 * 1024);
    const { svc } = makeService(
      { rows: fileRow({ status: 'pending', size_bytes: null }) },
      accessStub(),
      storage,
      budget,
    );
    await expectRejection(svc.finaliseUpload(USER, FILE_ID));
    expect(budget.inUse).toBe(0);
  });

  test('a full verify budget is a 503 that leaves the row pending to retry', async () => {
    const { setTimeout: realSetTimeout } = globalThis;
    // Skip the real 10s wait: fire budget timeouts at once.
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as any;
    try {
      const storage = storageStub(PDF);
      const budget = new ByteBudget(PDF.byteLength);
      const hold = await budget.acquire(PDF.byteLength, 0);
      const { svc, prisma } = makeService(
        { rows: fileRow({ status: 'pending', size_bytes: BigInt(PDF.byteLength) }) },
        accessStub(),
        storage,
        budget,
      );
      const err = await expectRejection(svc.finaliseUpload(USER, FILE_ID));
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(storage.getBuffer).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.file.updateMany).not.toHaveBeenCalled();
      expect(prisma.file.update).not.toHaveBeenCalled();

      // Once room frees up, the same pending row completes.
      hold();
      prisma.file.update.mockImplementation(async ({ data }) => fileRow({ ...data }));
      const out = await svc.finaliseUpload(USER, FILE_ID);
      expect(out.status).toBe('ready');
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test('completing with nothing uploaded fails the row', async () => {
    const { svc, prisma } = makeService({ rows: fileRow({ status: 'pending' }) });
    const err = await expectRejection(svc.finaliseUpload(USER, FILE_ID));
    expect((err as Error).message).toBe('The upload did not complete');
    expect(prisma.file.updateMany.mock.calls[0][0].data.status).toBe('failed');
  });

  test('a size mismatch deletes the object', async () => {
    const storage = storageStub(PDF);
    const { svc } = makeService(
      { rows: fileRow({ status: 'pending', size_bytes: BigInt(5) }) },
      accessStub(),
      storage,
    );
    expect(await expectRejection(svc.finaliseUpload(USER, FILE_ID))).toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.delete).toHaveBeenCalledWith('file-manager/s/p');
  });

  test('bytes that are not the declared type are rejected and deleted', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const storage = storageStub(html);
    const { svc } = makeService(
      { rows: fileRow({ status: 'pending', size_bytes: null }) },
      accessStub(),
      storage,
    );
    expect(await expectRejection(svc.finaliseUpload(USER, FILE_ID))).toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.delete).toHaveBeenCalled();
  });

  test('content is read from <bucket>/<path>', async () => {
    const storage = storageStub(PDF);
    const { svc } = makeService({ rows: fileRow() }, accessStub(), storage);
    (svc as any).access.accessFor = () =>
      Promise.resolve({ isOwner: true, canView: true, canDownload: true });
    const out = await svc.getDownloadContent(USER, FILE_ID);
    const chunks: Buffer[] = [];
    for await (const chunk of out.body) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(PDF)).toBe(true);
    expect(out.size).toBe(PDF.byteLength);
    expect(storage.get).toHaveBeenCalledWith('file-manager/s/p');
    // Served as a stream: a download never reads the object into memory.
    expect(storage.getBuffer).not.toHaveBeenCalled();
  });

  test('a ticket stages the upload away from the served key and signs its size', async () => {
    const { svc, prisma, storage } = makeService({ rows: null });
    await svc.createUploadTicket(USER, {
      name: 'Essay.pdf',
      sizeBytes: 100,
      contentType: 'application/pdf',
    });
    const row = prisma.file.create.mock.calls[0][0].data;
    expect(row.storage_path.startsWith('uploads/school-1/user-1/')).toBe(true);
    const [, , ttl, length] = storage.uploadUrl.mock.calls[0] as unknown as [
      string,
      string,
      number,
      number,
    ];
    expect(ttl).toBe(5 * 60);
    expect(length).toBe(100);
  });

  test('too many live tickets is a 429 and reserves nothing', async () => {
    const { svc, prisma } = makeService({ rows: null });
    prisma.file.count.mockResolvedValue(MAX_PENDING_UPLOADS);
    const err = await expectRejection(
      svc.createUploadTicket(USER, {
        name: 'a.pdf',
        sizeBytes: 10,
        contentType: 'application/pdf',
      }),
    );
    expect((err as any).getStatus()).toBe(429);
    expect(prisma.file.create).not.toHaveBeenCalled();
    const where = prisma.file.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ owner_id: USER, status: 'pending' });
  });

  test('finalising serves the verified bytes from a new key and drops the staged one', async () => {
    const storage = storageStub(PDF);
    const { svc, prisma } = makeService(
      {
        rows: fileRow({
          status: 'pending',
          storage_path: 'uploads/school-1/user-1/f1-doc.pdf',
          size_bytes: BigInt(PDF.byteLength),
        }),
      },
      accessStub(),
      storage,
    );
    prisma.file.update.mockImplementation(async ({ data }) =>
      fileRow({ ...data }),
    );
    await svc.finaliseUpload(USER, FILE_ID);

    expect(storage.getBuffer).toHaveBeenCalledWith(
      'file-manager/uploads/school-1/user-1/f1-doc.pdf',
      PDF.byteLength,
    );
    const [putKey, putBody] = storage.put.mock.calls[0] as unknown as [
      string,
      Buffer,
    ];
    expect(putKey).toBe('file-manager/school-1/user-1/f1-doc.pdf');
    expect(putBody.equals(PDF)).toBe(true);
    expect(prisma.file.update.mock.calls[0][0].data.storage_path).toBe(
      'school-1/user-1/f1-doc.pdf',
    );
    expect(storage.delete).toHaveBeenCalledWith(
      'file-manager/uploads/school-1/user-1/f1-doc.pdf',
    );
  });

  test('an object that grows past the cap after HEAD is rejected and deleted', async () => {
    const storage = storageStub(PDF);
    storage.getBuffer.mockImplementation(() =>
      Promise.reject(new ObjectTooLargeError('k', 1)),
    );
    const { svc, prisma } = makeService(
      { rows: fileRow({ status: 'pending', size_bytes: null }) },
      accessStub(),
      storage,
    );
    const err = await expectRejection(svc.finaliseUpload(USER, FILE_ID));
    expect((err as Error).message).toBe(
      'The uploaded file does not match the declared size',
    );
    expect(storage.delete).toHaveBeenCalled();
    expect(prisma.file.updateMany.mock.calls[0][0].data.status).toBe('failed');
  });

  test('finalise ignores deleted rows', async () => {
    const { svc, prisma } = makeService({ rows: null });
    await expectRejection(svc.finaliseUpload(USER, FILE_ID));
    expect(prisma.file.findFirst.mock.calls[0][0].where.deleted_at).toBeNull();
  });
});

describe('readContentForAuthorisedCaller', () => {
  test('a deleted file is not found', async () => {
    const { svc, prisma } = makeService({ rows: null });
    const err = await expectRejection(
      svc.readContentForAuthorisedCaller(FILE_ID),
    );
    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.file.findFirst.mock.calls[0][0].where).toEqual({
      id: FILE_ID,
      deleted_at: null,
    });
  });

  test('a malformed id is not found without a query', async () => {
    const { svc, prisma } = makeService({ rows: fileRow() });
    await expectRejection(svc.readContentForAuthorisedCaller('nope'));
    expect(prisma.file.findFirst).not.toHaveBeenCalled();
  });
});
