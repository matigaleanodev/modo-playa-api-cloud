import { Readable } from 'node:stream';
import type { ObjectStorageService } from '../packages/runtime/src/media/ports.ts';
export class MemoryStorage implements ObjectStorageService {
  readonly objects = new Map<string, { body: Buffer; mime: string }>();
  readonly calls: string[] = [];
  failPut: (key: string) => boolean = () => false;
  failDelete: (key: string) => boolean = () => false;
  async headObject(key: string) {
    this.calls.push('head:' + key);
    const value = this.objects.get(key);
    return value ? { exists: true, bytes: value.body.length, mime: value.mime } : { exists: false };
  }
  async getObjectStream(key: string) {
    const value = this.objects.get(key);
    if (!value) throw new Error('storage-missing');
    return { stream: Readable.from(value.body), bytes: value.body.length, mime: value.mime };
  }
  async putObject(input: Parameters<ObjectStorageService['putObject']>[0]) {
    const chunks: Buffer[] = [];
    for await (const chunk of input.body as AsyncIterable<Buffer>) chunks.push(chunk);
    this.objects.set(input.key, { body: Buffer.concat(chunks), mime: input.contentType });
    this.calls.push('put:' + input.key);
    if (this.failPut(input.key)) throw new Error('storage-put-failed');
  }
  async deleteObject(key: string) {
    this.calls.push('delete:' + key);
    if (this.failDelete(key)) throw new Error('storage-delete-failed');
    this.objects.delete(key);
  }
  async testConnection() {
    this.calls.push('head-bucket');
    return { ok: true, message: 'R2 connection successful' };
  }
}
