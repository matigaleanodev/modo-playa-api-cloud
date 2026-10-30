import { Ajv } from 'ajv';
import { httpEventSchema } from '@modo-playa/contracts/http-input';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DomainException, HttpException } from '../identity/errors.ts';
import { MediaDependencyUnavailable } from '../business/media.ts';
export const validateEvent = new Ajv({ strict: true }).compile<APIGatewayProxyEventV2>(
  httpEventSchema,
);
export const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});
export function errorResponse(error: unknown) {
  if (error instanceof DomainException)
    return json(error.status, { message: error.message, code: error.code });
  if (error instanceof HttpException) return json(error.status, error.body);
  if (error instanceof MediaDependencyUnavailable)
    return json(503, {
      statusCode: 503,
      message: 'Lodging media dependency unavailable',
      error: 'Service Unavailable',
    });
  return json(500, { statusCode: 500, message: 'Internal server error' });
}
export function queryParameters(event: APIGatewayProxyEventV2) {
  if (!event.rawQueryString) return event.queryStringParameters ?? {};
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(event.rawQueryString)) {
    const current = result[key];
    result[key] =
      current === undefined ? value : [...(Array.isArray(current) ? current : [current]), value];
  }
  return result;
}
export function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  try {
    return JSON.parse(
      event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body,
    );
  } catch {
    throw new HttpException(400, {
      message: 'Unexpected token in JSON',
      error: 'Bad Request',
      statusCode: 400,
    });
  }
}
export function notFound(event: APIGatewayProxyEventV2) {
  return json(404, {
    message: `Cannot ${event.requestContext.http.method} ${event.rawPath}`,
    error: 'Not Found',
    statusCode: 404,
  });
}
