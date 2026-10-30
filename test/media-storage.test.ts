import { afterEach, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { R2ObjectStorageService } from '../packages/runtime/src/media/storage.ts';
let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});
it('adapter S3 usa longitud conocida, HEAD/GET/DELETE y nunca reintenta una escritura fallida', async () => {
  const calls: { method: string; path: string; length: string | undefined; body: Buffer }[] = [];
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push({
      method: request.method!,
      path: new URL(request.url!, 'http://localhost').pathname,
      length: request.headers['content-length'],
      body: Buffer.concat(chunks),
    });
    if (request.url!.includes('fail')) {
      response.statusCode = 500;
      response.end('<Error><Code>InternalError</Code></Error>');
      return;
    }
    if (request.url!.includes('missing')) {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (request.method === 'GET') {
      response.setHeader('content-type', 'image/png');
      response.end('stored');
      return;
    }
    if (request.method === 'HEAD' && request.url!.includes('image')) {
      response.setHeader('content-type', 'image/webp');
      response.setHeader('content-length', '6');
    }
    response.statusCode = request.method === 'DELETE' ? 204 : 200;
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const storage = new R2ObjectStorageService(
    {
      endpoint,
      bucket: 'local',
      accessKeyId: 'explicit-local',
      secretAccessKey: 'explicit-local',
      region: 'auto',
    },
    AbortSignal.timeout(3000),
  );
  const before = new Set(
    (await readdir(tmpdir())).filter((name) => name.startsWith('modo-playa-media-')),
  );
  await storage.putObject({
    key: 'image',
    body: Readable.from([Buffer.from('stored')]),
    contentType: 'image/webp',
  });
  expect(calls[0]).toMatchObject({ method: 'PUT', path: '/local/image', length: '6' });
  expect(calls[0]!.body).toEqual(Buffer.from('stored'));
  expect(await storage.headObject('image')).toEqual({ exists: true, bytes: 6, mime: 'image/webp' });
  expect(await storage.headObject('missing')).toEqual({ exists: false });
  const retrieved = await storage.getObjectStream('image');
  const chunks: Buffer[] = [];
  for await (const chunk of retrieved.stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('stored');
  await storage.deleteObject('image');
  expect(await storage.testConnection()).toEqual({ ok: true, message: 'R2 connection successful' });
  await expect(
    storage.putObject({ key: 'fail', body: Readable.from('data'), contentType: 'image/webp' }),
  ).rejects.toThrow();
  expect(calls.filter((call) => call.method === 'PUT' && call.path.includes('fail'))).toHaveLength(
    1,
  );
  expect(
    (await readdir(tmpdir())).filter(
      (name) => name.startsWith('modo-playa-media-') && !before.has(name),
    ),
  ).toEqual([]);
});
it('cancelación impide put; compensación DELETE usa señal propia acotada', async () => {
  let calls = 0;
  server = createServer((_request, response) => {
    calls++;
    response.statusCode = 204;
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const abort = new AbortController();
  abort.abort(new Error('local-abort'));
  const storage = new R2ObjectStorageService(
    {
      endpoint: 'http://127.0.0.1:' + (server.address() as { port: number }).port,
      bucket: 'local',
      accessKeyId: 'local',
      secretAccessKey: 'local',
      region: 'auto',
    },
    abort.signal,
  );
  await expect(
    storage.putObject({ key: 'image', body: Readable.from('data'), contentType: 'image/png' }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  await storage.deleteObject('image');
  expect(calls).toBe(1);
});
