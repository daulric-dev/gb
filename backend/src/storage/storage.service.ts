import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { allowedOrigins } from '@/config/origins';

export interface StoredObject {
  body: Readable;
  contentType: string | null;
  size: number | null;
}

/** Hard ceiling on what `getBuffer` will hold in memory unless told otherwise. */
export const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** How long a presigned PUT stays valid unless the caller says otherwise. */
export const DEFAULT_UPLOAD_URL_TTL_SECONDS = 5 * 60;

/** Thrown by `getBuffer` when an object turns out bigger than its cap. */
export class ObjectTooLargeError extends Error {
  constructor(
    readonly key: string,
    readonly maxBytes: number,
  ) {
    super(`Object ${key} is larger than ${maxBytes} bytes`);
    this.name = 'ObjectTooLargeError';
  }
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly bucket = process.env.S3_BUCKET ?? 'gradebook';
  private readonly client = makeClient(process.env.S3_ENDPOINT);
  // Presigned URLs embed the host they were signed for, so sign with the
  // address the browser will use.
  private readonly publicClient = process.env.S3_PUBLIC_ENDPOINT
    ? makeClient(process.env.S3_PUBLIC_ENDPOINT)
    : this.client;

  /**
   * Development stores start empty; create the bucket instead of failing, and
   * give it the CORS rule browsers need to PUT to presigned URLs. Production
   * buckets are configured once by hand (docs/content/platform-migration.md).
   */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'production' || !process.env.S3_ENDPOINT) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created development bucket "${this.bucket}"`);
      } catch (err) {
        this.logger.warn(`Storage not reachable: ${(err as Error).message}`);
        return;
      }
    }
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: { CORSRules: [corsRule()] },
        }),
      );
    } catch (err) {
      this.logger.warn(`Could not set bucket CORS: ${(err as Error).message}`);
    }
  }

  async put(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Copy an object inside the bucket without passing its bytes through the
   * API. The content type is set afresh rather than carried over from the
   * source.
   */
  async copy(fromKey: string, toKey: string, contentType: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: toKey,
        CopySource: `${this.bucket}/${encodeURIComponent(fromKey).replace(/%2F/g, '/')}`,
        MetadataDirective: 'REPLACE',
        ContentType: contentType,
      }),
    );
  }

  /** The object, or null when there is no such key. */
  async get(key: string): Promise<StoredObject | null> {
    let res: GetObjectCommandOutput;
    try {
      res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    return {
      body: res.Body as Readable,
      contentType: res.ContentType ?? null,
      size: res.ContentLength ?? null,
    };
  }

  /**
   * The whole object in memory, or null when there is no such key. The body
   * is counted as it streams in and abandoned as soon as it passes
   * `maxBytes` (ObjectTooLargeError): the reported size is not trusted, since
   * the object can be replaced between a HEAD and this GET.
   */
  async getBuffer(
    key: string,
    maxBytes = DEFAULT_MAX_BUFFER_BYTES,
  ): Promise<Buffer | null> {
    const obj = await this.get(key);
    if (!obj) return null;
    return readCapped(obj.body, key, maxBytes);
  }

  async exists(key: string): Promise<{ size: number; contentType: string | null } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    if (list.length === 0) return;
    if (list.length === 1) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: list[0] }));
      return;
    }
    // DeleteObjects takes at most 1000 keys per call.
    for (let i = 0; i < list.length; i += 1000) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: list.slice(i, i + 1000).map((Key) => ({ Key })) },
        }),
      );
    }
  }

  /**
   * Keys under `prefix`, in ascending key order; listing stops before the
   * first key >= `endBefore`.
   */
  async listKeys(
    prefix: string,
    opts: { endBefore?: string } = {},
  ): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        if (opts.endBefore && obj.Key >= opts.endBefore) return keys;
        keys.push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  /** A URL the browser can GET the object from, for `expiresIn` seconds. */
  async downloadUrl(
    key: string,
    opts: { expiresIn?: number; filename?: string; inline?: boolean } = {},
  ): Promise<string> {
    const disposition = opts.filename
      ? `${opts.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(opts.filename)}`
      : undefined;
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: opts.expiresIn ?? 300 },
    );
  }

  /**
   * A URL the client PUTs the file body to. The content type, and the length
   * when given, are part of the signature, so the client must send exactly
   * this Content-Type and a body of exactly `contentLength` bytes.
   */
  async uploadUrl(
    key: string,
    contentType: string,
    expiresIn = DEFAULT_UPLOAD_URL_TTL_SECONDS,
    contentLength?: number,
  ): Promise<string> {
    const signed = new Set(['content-type']);
    if (contentLength !== undefined) signed.add('content-length');
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      // The presigner leaves Content-Type unsigned by default; sign both.
      { expiresIn, signableHeaders: signed },
    );
  }
}

/** Browsers PUT uploads and GET downloads straight from the web origins. */
export function corsRule() {
  return {
    AllowedOrigins: [...new Set([...allowedOrigins(), 'http://localhost:3000'])],
    AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedHeaders: ['Content-Type'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  };
}

function makeClient(endpoint: string | undefined): S3Client {
  return new S3Client({
    endpoint: endpoint || undefined,
    region: process.env.S3_REGION ?? 'auto',
    // The SDK's default flexible checksums get baked into presigned URLs as
    // a checksum of an empty body, which every non-AWS store rejects on the
    // real upload. Only send checksums when an operation requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    forcePathStyle:
      process.env.S3_FORCE_PATH_STYLE === 'true' || (!!endpoint && process.env.S3_FORCE_PATH_STYLE !== 'false'),
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

/** Collect a stream, giving up (and closing it) past `maxBytes`. */
export async function readCapped(
  body: Readable,
  key: string,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.from(chunk as Uint8Array);
    total += buf.byteLength;
    if (total > maxBytes) {
      body.destroy?.();
      throw new ObjectTooLargeError(key, maxBytes);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function isMissing(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}
