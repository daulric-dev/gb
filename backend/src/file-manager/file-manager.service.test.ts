import { describe, test, expect, mock } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FileManagerService } from './file-manager.service';
import { FileListFilter } from './dto/list-files.filter';
import { expectRejection } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { createMockPrisma } from '@/test/prisma-mock';

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
    put: mock(() => Promise.resolve()),
    delete: mock(() => Promise.resolve()),
  };
}

function makeService(
  fileResult: { rows: any; count?: number },
  access = accessStub(),
  storage = storageStub(),
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
  );
  return { svc, prisma, storage };
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
      maxBytes: 10 * 1024 * 1024,
    });
    expect(t.uploadUrl).toContain(`file-manager/${row.storage_path}`);
    expect(typeof t.expiresAt).toBe('string');
  });

  test('a ticket for a disallowed type or size is refused', async () => {
    const { svc } = makeService({ rows: null });
    for (const input of [
      { name: 'a.exe', sizeBytes: 10, contentType: 'application/x-msdownload' },
      { name: 'a.pdf', sizeBytes: 11 * 1024 * 1024, contentType: 'application/pdf' },
    ]) {
      expect(await expectRejection(svc.createUploadTicket(USER, input))).toBeInstanceOf(
        BadRequestException,
      );
    }
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
    expect(out.buffer.equals(PDF)).toBe(true);
    expect(storage.getBuffer).toHaveBeenCalledWith('file-manager/s/p');
  });
});
