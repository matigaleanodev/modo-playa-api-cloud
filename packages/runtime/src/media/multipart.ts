import busboy from 'busboy';
import type { IncomingMessage } from 'node:http';
import { DomainException, HttpException } from '../identity/errors.ts';
import type { UploadedImageFile } from './ports.ts';
const invalid = () =>
  new HttpException(400, {
    message: 'Malformed multipart request',
    error: 'Bad Request',
    statusCode: 400,
  });
const sizeError = () =>
  new DomainException('Image size exceeded', 'LODGING_IMAGE_SIZE_EXCEEDED', 400);
// Each maximum file still fits in addition to fields, boundaries and multipart headers.
export const multipartOverheadBytes = 128 * 1024;
export async function parseMultipart(
  request: IncomingMessage,
  maxBytes: number,
  signal: AbortSignal,
) {
  let problem: unknown;
  let file: UploadedImageFile | undefined;
  const fields: Record<string, unknown> = {};
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: request.headers,
      limits: { fileSize: maxBytes + 1, files: 1, fields: 16, fieldSize: 64 * 1024, parts: 17 },
    });
  } catch {
    await drain(request, signal);
    throw invalid();
  }
  parser.on('file', (name, stream, info) => {
    const chunks: Buffer[] = [];
    let size = 0;
    if (name !== 'file')
      problem = new HttpException(400, {
        message: 'Unexpected field',
        error: 'Bad Request',
        statusCode: 400,
      });
    stream.on('error', () => {
      problem ??= invalid();
    });
    stream.on('limit', () => {
      problem = sizeError();
    });
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) problem = sizeError();
      if (!problem) chunks.push(chunk);
    });
    stream.on('end', () => {
      if (!problem) file = { buffer: Buffer.concat(chunks), size, mimetype: info.mimeType };
    });
  });
  parser.on('field', (name, value, info) => {
    if (info.valueTruncated || info.nameTruncated) problem = invalid();
    const prior = fields[name];
    fields[name] =
      prior === undefined ? value : Array.isArray(prior) ? [...prior, value] : [prior, value];
  });
  parser.on('filesLimit', () => {
    problem = new HttpException(400, {
      message: 'Unexpected field',
      error: 'Bad Request',
      statusCode: 400,
    });
  });
  parser.on('fieldsLimit', () => {
    problem = invalid();
  });
  parser.on('partsLimit', () => {
    problem = invalid();
  });
  parser.on('error', () => {
    problem = invalid();
  });
  let total = 0;
  const abort = () => request.destroy();
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of request) {
      signal.throwIfAborted();
      total += chunk.length;
      if (total > maxBytes + multipartOverheadBytes) problem = sizeError();
      // Keep consuming on rejections: Web Functions delivers responses only after the request body.
      if (!parser.destroyed) {
        if (!parser.write(chunk))
          await new Promise<void>((resolve) => {
            parser.once('drain', resolve);
            parser.once('close', resolve);
          });
      }
    }
    if (!parser.destroyed)
      await new Promise<void>((resolve) => {
        parser.once('close', resolve);
        parser.end();
      });
    if (problem) throw problem;
    return { file, fields };
  } finally {
    signal.removeEventListener('abort', abort);
    parser.destroy();
  }
}
export async function drain(request: IncomingMessage, signal: AbortSignal) {
  if (request.readableEnded || request.destroyed) return;
  const abort = () => request.destroy();
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const _chunk of request) {
      signal.throwIfAborted();
    }
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
export async function parseJson(request: IncomingMessage, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let size = 0;
  let exceeded = false;
  const abort = () => request.destroy();
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of request) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > 1024 * 1024) exceeded = true;
      if (!exceeded) chunks.push(chunk);
    }
    if (exceeded)
      throw new HttpException(400, {
        message: 'Request body too large',
        error: 'Bad Request',
        statusCode: 400,
      });
    if (!size) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new HttpException(400, {
        message: 'Unexpected token in JSON',
        error: 'Bad Request',
        statusCode: 400,
      });
    }
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
