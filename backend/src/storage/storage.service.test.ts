import { describe, test, expect, afterAll, mock } from 'bun:test';
import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import {
  ObjectTooLargeError,
  StorageService,
  readCapped,
} from './storage.service';

describe('readCapped', () => {
  const chunks = () =>
    Readable.from([Buffer.alloc(4, 1), Buffer.alloc(4, 2), Buffer.alloc(4, 3)]);

  test('collects a body within the cap', async () => {
    const buf = await readCapped(chunks(), 'k', 12);
    expect(buf.byteLength).toBe(12);
  });

  test('stops and throws once the body passes the cap', async () => {
    const body = chunks();
    const err = await readCapped(body, 'k', 6).catch((e) => e);
    expect(err).toBeInstanceOf(ObjectTooLargeError);
    expect(body.destroyed).toBe(true);
  });
});

describe('uploadUrl', () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = saved;
  });

  function service() {
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_PUBLIC_ENDPOINT = '';
    process.env.S3_ACCESS_KEY_ID = 'test';
    process.env.S3_SECRET_ACCESS_KEY = 'test';
    return new StorageService();
  }

  test('signs content type and length, valid for 5 minutes by default', async () => {
    const url = new URL(
      await service().uploadUrl('file-manager/uploads/a', 'application/pdf', undefined, 123),
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    const signed = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
    expect(signed).toContain('content-type');
    expect(signed).toContain('content-length');
  });

  test('leaves the length unsigned when none is given', async () => {
    const url = new URL(await service().uploadUrl('k', 'image/png'));
    const signed = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
    expect(signed).toContain('content-type');
    expect(signed).not.toContain('content-length');
  });
});

describe('copy', () => {
  test('copies inside the bucket and replaces the content type', async () => {
    const svc = new StorageService();
    const send = mock(() => Promise.resolve({}));
    (svc as any).client = { send };
    await svc.copy('file-manager/uploads/a b.rs', 'file-manager/a b.rs', 'text/x-rust');
    const cmd = (send.mock.calls[0] as unknown as [CopyObjectCommand])[0];
    expect(cmd).toBeInstanceOf(CopyObjectCommand);
    expect(cmd.input).toEqual({
      Bucket: svc.bucket,
      Key: 'file-manager/a b.rs',
      CopySource: `${svc.bucket}/file-manager/uploads/a%20b.rs`,
      MetadataDirective: 'REPLACE',
      ContentType: 'text/x-rust',
    });
  });
});
