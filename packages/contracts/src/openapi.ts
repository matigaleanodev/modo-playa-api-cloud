import { routes } from './routes.ts';

export function createOpenApiDocument() {
  return {
    openapi: '3.1.1',
    jsonSchemaDialect: 'http://json-schema.org/draft-07/schema#',
    info: { title: 'Modo Playa API', version: '0.1.0' },
    paths: Object.fromEntries(
      Object.values(routes).map((route) => [
        route.path,
        {
          [route.method.toLowerCase()]: {
            operationId: route.operation,
            'x-lambda-group': route.group,
            responses: Object.fromEntries(
              Object.entries(route.responses).map(([status, response]) => [
                status,
                {
                  description: response.description,
                  content: { [response.mediaType]: { schema: response.schema } },
                },
              ]),
            ),
          },
        },
      ]),
    ),
  };
}
