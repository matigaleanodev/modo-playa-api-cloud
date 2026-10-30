import type { JSONSchema } from 'json-schema-to-ts';
import { routes, type RouteMetadata } from './routes.ts';

export function createOpenApiDocument() {
  const paths: Record<string, Record<string, ReturnType<typeof describeOperation>>> = {};
  for (const route of Object.values(routes) as RouteMetadata[]) {
    (paths[route.path] ??= {})[route.method.toLowerCase()] = describeOperation(route);
  }
  return {
    openapi: '3.1.1',
    jsonSchemaDialect: 'http://json-schema.org/draft-07/schema#',
    info: { title: 'Modo Playa API', version: '1.0.0' },
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
  const requestBody:
    { required: boolean; content: Record<string, { schema: JSONSchema }> } | undefined =
    route.multipart
      ? {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: [
                  'file',
                  ...(route.body && typeof route.body === 'object' && 'required' in route.body
                    ? (route.body.required as string[])
                    : []),
                ],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  ...(route.body && typeof route.body === 'object' && 'properties' in route.body
                    ? (route.body.properties as object)
                    : {}),
                },
              },
            },
          },
        }
      : route.body
        ? { required: true, content: { 'application/json': { schema: route.body } } }
        : undefined;
  return {
    operationId: route.operation,
    'x-lambda-group': route.group,
    ...(route.mediaDependency
      ? {
          'x-required-media-dependency': route.mediaDependency,
          description:
            'Requiere asociación real de drafts o limpieza de objetos, según la operación.',
        }
      : {}),
    ...(route.bearer ? { security: [{ bearerAuth: [] }] } : {}),
    ...(parameters.length ? { parameters } : {}),
    requestBody,
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
