import { expect, it } from 'vitest';
import { createOpenApiDocument } from '@modo-playa/contracts/openapi';
import { routes } from '@modo-playa/contracts/routes';

it('genera solo las operaciones implementadas y los schemas de la metadata neutral', () => {
  const document = createOpenApiDocument();
  expect(document.openapi).toBe('3.1.1');
  expect(Object.keys(document.paths)).toEqual(Object.values(routes).map((route) => route.path));
  for (const route of Object.values(routes)) {
    const path = document.paths[route.path]!;
    expect(Object.keys(path)).toEqual([route.method.toLowerCase()]);
    const operation = path[route.method.toLowerCase()]!;
    expect(operation.operationId).toBe(route.operation);
    expect(operation['x-lambda-group']).toBe(route.group);
    expect(operation.responses['200']!.content['application/json']!.schema).toEqual(
      route.responses[200].schema,
    );
    expect(operation).not.toHaveProperty('requestBody');
  }
});
