import { expect, it } from 'vitest';
import { createOpenApiDocument } from '@modo-playa/contracts/openapi';
import { routes, type RouteMetadata } from '@modo-playa/contracts/routes';

it('conserva todos los métodos por path, parámetros, requests, respuestas y Bearer de la metadata', () => {
  const document = createOpenApiDocument();
  expect(document.openapi).toBe('3.1.1');
  expect(Object.keys(document.paths)).toEqual([
    ...new Set(Object.values(routes).map((route) => route.path)),
  ]);
  for (const route of Object.values(routes) as RouteMetadata[]) {
    const path = document.paths[route.path]!;
    const operation = path[route.method.toLowerCase()]!;
    expect(operation.operationId).toBe(route.operation);
    expect(operation['x-lambda-group']).toBe(route.group);
    expect(operation.responses).toEqual(
      Object.fromEntries(
        Object.entries(route.responses).map(([status, response]) => [
          status,
          {
            description: response.description,
            content: { [response.mediaType]: { schema: response.schema } },
          },
        ]),
      ),
    );
    expect(operation.requestBody?.content['application/json'].schema).toEqual(route.body);
    expect(operation.security).toEqual(route.bearer ? [{ bearerAuth: [] }] : undefined);
  }
  expect(Object.keys(document.paths['/api/auth/me']!)).toEqual(['get', 'patch']);
  expect(Object.keys(document.paths['/api/admin/users']!)).toEqual(['post', 'get']);
  expect(Object.keys(document.paths['/api/admin/users/{id}']!)).toEqual(['get', 'patch']);
  expect(document.paths['/api/admin/users/{id}']!.get!.parameters).toContainEqual({
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string' },
  });
  expect(Object.values(routes)).toHaveLength(35);
});
