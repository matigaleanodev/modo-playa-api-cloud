import { routes, type RouteMetadata } from './routes.ts';

export function createOpenApiDocument() {
  const paths: Record<string, Record<string, ReturnType<typeof describeOperation>>> = {};
  for (const route of Object.values(routes) as RouteMetadata[]) {
    (paths[route.path] ??= {})[route.method.toLowerCase()] = describeOperation(route);
  }
  return {
    openapi: '3.1.1',
    jsonSchemaDialect: 'http://json-schema.org/draft-07/schema#',
    info: { title: 'Modo Playa API', version: '0.1.0' },
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
  };
}

function describeOperation(route: RouteMetadata) {
  const parameters = [
    ...Object.entries(route.parameters?.properties ?? {}).map(([name, schema]) => ({
      name,
      in: 'path',
      required: true,
      schema,
    })),
    ...Object.entries(route.query?.properties ?? {}).map(([name, schema]) => ({
      name,
      in: 'query',
      required: false,
      schema,
    })),
  ];
  return {
    operationId: route.operation,
    'x-lambda-group': route.group,
    ...(route.mediaDependency
      ? {
          'x-required-media-dependency': route.mediaDependency,
          description: 'Contrato local; requiere integración real de media antes de publicación.',
        }
      : {}),
    ...(route.bearer ? { security: [{ bearerAuth: [] }] } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(route.body
      ? { requestBody: { required: true, content: { 'application/json': { schema: route.body } } } }
      : {}),
    responses: Object.fromEntries(
      Object.entries(route.responses).map(([status, response]) => [
        status,
        {
          description: response.description,
          content: { [response.mediaType]: { schema: response.schema } },
        },
      ]),
    ),
  };
}
