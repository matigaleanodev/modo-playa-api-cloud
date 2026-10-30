import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ObjectStorageService } from './ports.ts';
export interface StorageSettings {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}
export class R2ObjectStorageService implements ObjectStorageService {
  private readonly client: S3Client;
  constructor(
    private readonly settings: StorageSettings,
    private readonly signal?: AbortSignal,
  ) {
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: true,
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });
  }
  async headObject(key: string) {
    try {
      const value = await this.client.send(
        new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }),
        { abortSignal: this.signal },
      );
      return { exists: true, bytes: value.ContentLength, mime: value.ContentType };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        '$metadata' in error &&
        (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404
      )
        return { exists: false };
      throw error;
    }
  }
  async getObjectStream(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }),
      { abortSignal: this.signal },
    );
    if (!(result.Body instanceof Readable)) throw new Error('Storage stream unavailable.');
    return { stream: result.Body, bytes: result.ContentLength, mime: result.ContentType };
  }
  async putObject(input: Parameters<ObjectStorageService['putObject']>[0]) {
    // R2 receives a known ContentLength; spool avoids a second whole-image heap buffer.
    const directory = await mkdtemp(join(tmpdir(), 'modo-playa-media-'));
    const path = join(directory, 'object');
    try {
      await pipeline(input.body as Readable, createWriteStream(path, { mode: 0o600 }), {
        signal: this.signal,
      });
      const { size } = await stat(path);
      const body = createReadStream(path);
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.settings.bucket,
            Key: input.key,
            Body: body,
            ContentLength: size,
            ContentType: input.contentType,
            ...(input.cacheControl ? { CacheControl: input.cacheControl } : {}),
          }),
          { abortSignal: this.signal },
        );
      } finally {
        body.destroy();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  async deleteObject(key: string) {
    // Compensation must still run when the request signal has already been aborted.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(3000),
    });
  }
  async testConnection() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }), {
        abortSignal: this.signal,
      });
      return { ok: true, message: 'R2 connection successful' };
    } catch (error) {
      return {
        ok: false,
        message: 'R2 connection failed: ' + (error instanceof Error ? error.name : 'Storage error'),
      };
    }
  }
}
