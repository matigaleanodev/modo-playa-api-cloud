import { expect, it, vi } from 'vitest';
import { protectEventOrigin } from '../packages/runtime/src/http/origin.ts';
import { createHealthHandler } from '../packages/runtime/src/health/handler.ts';
import { event, context } from './helpers.ts';

const reference =
  'arn:aws:secretsmanager:us-east-1:650387442642:secret:modo-playa/prod/ingress-ABC123';
const value = 'simulated-origin-token-with-at-least-32-characters';

it('origen JSON rechaza acceso directo/headers falsos antes del handler, incl HEAD y OPTIONS', async () => {
  const run = vi.fn(async () => ({ statusCode: 200 }));
  const read = vi.fn(async (_reference: string) => JSON.stringify({ ORIGIN_VERIFY_TOKEN: value }));
  const handler = protectEventOrigin(run, { ORIGIN_SECRET_ARN: reference }, read);
  expect(read).not.toHaveBeenCalled();
  for (const method of ['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS']) {
    const input = event('/api/health', method);
    input.headers = { 'cf-connecting-ip': '127.0.0.1', 'x-forwarded-for': '127.0.0.1' };
    expect((await handler(input, context)).statusCode).toBe(403);
    input.headers['x-modo-playa-origin'] = 'wrong';
    expect((await handler(input, context)).statusCode).toBe(403);
  }
  expect(run).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0]![0]).toBe(reference);
  const input = event('/api/admin/lodgings', 'DELETE');
  input.headers = { 'X-Modo-Playa-Origin': value, authorization: 'Bearer simulated-user' };
  input.rawQueryString = 'id=a&id=b';
  input.body = '{"from":"2026-01-01","to":"2026-01-02"}';
  expect((await handler(input, context)).statusCode).toBe(200);
  expect(run).toHaveBeenCalledWith(input, context);
  expect(input.headers.authorization).toBe('Bearer simulated-user');
});

it('configuración ausente/malformada falla saneada y recupera lectura; smoke usa token explícito', async () => {
  const run = vi.fn(async () => ({ statusCode: 200 }));
  const unavailable = protectEventOrigin(run, {});
  expect((await unavailable(event(), context)).statusCode).toBe(503);
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('sensitive-origin-value'))
    .mockResolvedValue(JSON.stringify({ ORIGIN_VERIFY_TOKEN: value }));
  const handler = protectEventOrigin(run, { ORIGIN_SECRET_ARN: reference }, read);
  const failed = await handler(event(), context);
  expect(failed.statusCode).toBe(503);
  expect(failed.body).not.toContain('sensitive');
  const input = event();
  input.headers['x-modo-playa-origin'] = value;
  expect((await handler(input, context)).statusCode).toBe(200);
  expect(read).toHaveBeenCalledTimes(2);
  const local = protectEventOrigin(createHealthHandler({ logRequests: false }), {
    ORIGIN_VERIFY_TOKEN: value,
  });
  expect((await local(input, context)).statusCode).toBe(200);
  const preflight = event('/api/health', 'OPTIONS');
  preflight.headers = { 'x-modo-playa-origin': value, origin: 'https://admin.example.test' };
  const guarded = protectEventOrigin(run, {
    ORIGIN_VERIFY_TOKEN: value,
    CORS_ORIGIN: 'https://admin.example.test',
  });
  run.mockClear();
  const response = await guarded(preflight, context);
  expect(response).toMatchObject({
    statusCode: 204,
    headers: {
      'access-control-allow-origin': 'https://admin.example.test',
      'access-control-allow-headers': 'Authorization,Content-Type',
    },
  });
  expect(run).not.toHaveBeenCalled();
  preflight.headers.origin = 'https://unlisted.example.test';
  expect((await guarded(preflight, context)).headers).not.toHaveProperty(
    'access-control-allow-origin',
  );
  const head = event(undefined, 'HEAD');
  head.headers['x-modo-playa-origin'] = value;
  const result = await local(head, context);
  expect(result.statusCode).toBe(200);
  expect(result.body).toBeUndefined();
  expect(head.requestContext.http.method).toBe('HEAD');
});

it('documentación conserva protección de origen, HEAD y preflight', async () => {
  const handler = protectEventOrigin(createHealthHandler({ logRequests: false }), {
    ORIGIN_VERIFY_TOKEN: value,
    CORS_ORIGIN: 'https://admin.example.test',
  });
  for (const path of ['/docs', '/docs/', '/openapi.json']) {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const request = event(path, method);
      expect((await handler(request, context)).statusCode).toBe(403);
      request.headers = {
        'x-modo-playa-origin': value,
        origin: 'https://admin.example.test',
      };
      const response = await handler(request, context);
      expect(response.statusCode).toBe(method === 'OPTIONS' ? 204 : 200);
      expect(response.headers?.['access-control-allow-origin']).toBe('https://admin.example.test');
      if (method !== 'GET') expect(response.body).toBeUndefined();
    }
  }
});
