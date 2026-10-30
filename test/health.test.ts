import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { healthResponseSchema } from '@modo-playa/contracts/health';
import { routes } from '@modo-playa/contracts/routes';
import { createOpenApiDocument } from '@modo-playa/contracts/openapi';
import { createHealthHandler } from '@modo-playa/runtime/health';
import { selectOperation } from '../packages/runtime/src/http/operation.ts';
import { context, event } from './helpers.ts';

describe('Health y selección de operación', () => {
  const handler = createHealthHandler({ logRequests: false });

  it('conserva el estado HTTP y el objeto de la API original sin body obligatorio', async () => {
    const response = await handler(event(), context);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"status":"ok"}');
    const validate = new Ajv({ strict: true }).compile(healthResponseSchema);
    expect(validate(JSON.parse(response.body!))).toBe(true);
    expect(validate([{ status: 'ok' }])).toBe(false);
  });

  it('ignora query y body como la operación original sin entradas declaradas', async () => {
    const request = { ...event(), rawQueryString: 'unknown=1&unknown=2', body: 'no es JSON' };
    expect((await handler(request, context)).statusCode).toBe(200);
  });

  it('selecciona únicamente la operación declarada para health', () => {
    expect(selectOperation('health', event())).toBe(routes.health);
    expect(selectOperation('health', event('/api/lodgings'))).toBeUndefined();
    expect(selectOperation('health', event('/api/health', 'POST'))).toBeUndefined();
    expect(selectOperation('health', { ...event(), rawPath: '/api/lodgings' })).toBeUndefined();
  });

  it('rechaza rutas no declaradas y métodos distintos sin ejecutar health', async () => {
    for (const request of [event('/api/not-declared'), event('/api/health', 'POST')]) {
      const response = await handler(request, context);
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body!)).toMatchObject({ statusCode: 404, error: 'Not Found' });
    }
  });

  it('rechaza el sobre de transporte inválido con AJV antes de seleccionar', async () => {
    expect((await handler({ ...event(), version: '1.0' }, context)).statusCode).toBe(400);
  });
});

describe('Documentación HTTP en el origen health', () => {
  const handler = createHealthHandler({ logRequests: false });

  it('sirve Swagger UI y el contrato vigente fuera del prefijo /api', async () => {
    for (const path of ['/docs', '/docs/']) {
      const response = await handler(event(path), context);
      expect(response.statusCode).toBe(200);
      expect(response.headers?.['content-type']).toBe('text/html; charset=utf-8');
      expect(response.body).toContain('Swagger UI');
      expect(response.body).toContain("url:'/openapi.json'");
      expect(response.body).toContain('swagger-ui-dist@5.31.0/');
      expect(response.body).toContain('integrity="sha384-');
      expect(response.body).toContain('validatorUrl:null');
    }
    const response = await handler(event('/openapi.json'), context);
    expect(response.statusCode).toBe(200);
    expect(response.headers?.['content-type']).toBe('application/json; charset=utf-8');
    const document = JSON.parse(response.body!);
    expect(document).toEqual(createOpenApiDocument());
    expect(document.paths).toHaveProperty('/api/auth/login');
    expect(document.paths).not.toHaveProperty('/docs');
  });

  it('rechaza métodos, variantes y routeKey discordantes sin servir documentación', async () => {
    for (const request of [
      event('/docs', 'POST'),
      event('/openapi.json', 'DELETE'),
      event('/api/docs'),
      event('/docs/extra'),
      { ...event('/docs'), rawPath: '/api/health' },
      { ...event('/api/health'), rawPath: '/openapi.json' },
    ])
      expect((await handler(request, context)).statusCode).toBe(404);
  });
});
