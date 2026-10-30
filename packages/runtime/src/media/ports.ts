import type { Readable, Duplex } from 'node:stream';
export interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
export interface MediaSettings {
  get(name: string): string | undefined;
}
export interface ImageMetadata {
  width: number;
  height: number;
  bytes?: number;
  mime: 'image/webp';
}
export interface ImageProcessorService {
  createLodgingNormalizerTransform(input: {
    maxWidth: number;
    maxHeight: number;
    outputFormat: 'webp';
    quality?: number;
  }): { transform: Duplex; getMetadata(): Promise<ImageMetadata> };
}
export interface ObjectStorageService {
  headObject(key: string): Promise<{ exists: boolean; bytes?: number; mime?: string }>;
  getObjectStream(key: string): Promise<{ stream: Readable; bytes?: number; mime?: string }>;
  putObject(input: {
    key: string;
    body: NodeJS.ReadableStream;
    contentType: string;
    cacheControl?: string;
  }): Promise<void>;
  deleteObject(key: string): Promise<void>;
  testConnection?(): Promise<{ ok: boolean; message: string }>;
}
