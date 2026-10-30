import type sharp from 'sharp';
import type { ImageMetadata, ImageProcessorService } from './ports.ts';
export class SharpImageProcessorService implements ImageProcessorService {
  constructor(private readonly createSharp: typeof sharp) {}
  createLodgingNormalizerTransform(input: {
    maxWidth: number;
    maxHeight: number;
    outputFormat: 'webp';
    quality?: number;
  }) {
    const transform = this.createSharp()
      .rotate()
      .resize({
        width: input.maxWidth,
        height: input.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: input.quality ?? 82 });
    let bytes = 0;
    let dimensions: { width: number; height: number } | undefined;
    const metadata = new Promise<ImageMetadata>((resolve, reject) => {
      transform.once('info', (info) => {
        dimensions = info;
      });
      transform.once('error', reject);
      transform.once('end', () =>
        dimensions
          ? resolve({ ...dimensions, bytes, mime: 'image/webp' })
          : reject(new Error('Image metadata unavailable.')),
      );
    });
    // Callers may fail the storage pipeline before they request metadata.
    void metadata.catch(() => {});
    transform.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    return { transform, getMetadata: () => metadata };
  }
}
