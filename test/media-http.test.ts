import { beforeEach, afterEach, it, expect } from 'vitest';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createMediaServer } from '../packages/runtime/src/media/server.ts';
import { TokenService } from '../packages/runtime/src/identity/tokens.ts';
const tokens = new TokenService('explicit-no-database-test');
const authorization =
  'Bearer ' + tokens.sign({ sub: 'local-user', ownerId: 'local-owner' }, { expiresIn: 60 });
let server: ReturnType<typeof createMediaServer>, base: string, serviceCalls: number;
beforeEach(async () => {
  serviceCalls = 0;
  server = createMediaServer({
    logRequests: false,
    runtime: async () => ({
      tokens,
      config: {
        lodgingMaxBytes: 10 * 1024 * 1024,
        profileMaxBytes: 5 * 1024 * 1024,
        requestTimeoutMs: 1000,
      },
      services: async () => {
        serviceCalls++;
        return { health: async () => ({ ok: true, message: 'R2 connection successful' }) } as never;
      },
    }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it('multipart con FileStream truncado o abortado no tumba Node y nunca entra en servicios', async () => {
  const body =
    '--broken\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\npartial';
  const headers = { authorization, 'content-type': 'multipart/form-data; boundary=broken' };
  const response = await fetch(base + '/api/auth/me/profile-image', {
    method: 'POST',
    headers,
    body,
  });
  expect(response.status).toBe(400);
  expect(serviceCalls).toBe(0);
  await new Promise<void>((resolve) => {
    const request = httpRequest(base + '/api/auth/me/profile-image', {
      method: 'POST',
      headers: { ...headers, 'content-length': 100000 },
    });
    request.on('error', () => resolve());
    request.write(body);
    setTimeout(() => request.destroy(new Error('local-abort')), 20);
  });
  const alive = await fetch(base + '/api/admin/media/health', { headers: { authorization } });
  expect(alive.status).toBe(200);
  expect(serviceCalls).toBe(1);
});
it('HEAD tiene status y headers de GET, omite body y preserva JWT/slash sin Mongo', async () => {
  const get = await fetch(base + '/api/admin/media/health/', { headers: { authorization } });
  const head = await fetch(base + '/api/admin/media/health/', {
    method: 'HEAD',
    headers: { authorization },
  });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
  expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
  const denied = await fetch(base + '/api/admin/media/health/', { method: 'HEAD' });
  expect(denied.status).toBe(401);
  expect(await denied.text()).toBe('');
  expect(serviceCalls).toBe(2);
  expect(
    (await fetch(base + '/api/admin/media/health-extra', { headers: { authorization } })).status,
  ).toBe(404);
});
