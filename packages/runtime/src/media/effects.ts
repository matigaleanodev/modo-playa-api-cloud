import { PassThrough, Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DomainException } from '../identity/errors.ts';
import type { ImageProcessorService, ObjectStorageService } from './ports.ts';
export async function cleanupObjects(storage: ObjectStorageService, keys: string[]) {
  await Promise.allSettled(keys.map((key) => storage.deleteObject(key)));
}
export async function normalizeAndStore(
  storage: ObjectStorageService,
  processor: ImageProcessorService,
  input: {
    key: string;
    source: Readable;
    maxBytes: number;
    maxWidth: number;
    maxHeight: number;
    quality?: number;
    signal?: AbortSignal;
  },
) {
  const handle = processor.createLodgingNormalizerTransform({ ...input, outputFormat: 'webp' });
  const output = new PassThrough();
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(
        received > input.maxBytes
          ? new DomainException('Image size exceeded', 'LODGING_IMAGE_SIZE_EXCEEDED', 400)
          : null,
        chunk,
      );
    },
  });
  const metadata = handle.getMetadata();
  void metadata.catch(() => {});
  const writing = storage.putObject({
    key: input.key,
    body: output,
    contentType: 'image/webp',
    cacheControl: 'public, max-age=31536000, immutable',
  });
  const processing = pipeline(input.source, limit, handle.transform, output, {
    signal: input.signal,
  });
  try {
    await Promise.all([writing, processing]);
    return await metadata;
  } catch (error) {
    input.source.destroy();
    limit.destroy();
    handle.transform.destroy();
    output.destroy();
    // Wait for the writer to stop before deleting, so a late put cannot undo compensation.
    await Promise.allSettled([writing, processing]);
    await cleanupObjects(storage, [input.key]);
    throw error;
  }
}
