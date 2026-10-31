import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import {
  applyParameter,
  readParameter,
  refreshing,
  type ParameterReader,
} from './parameter-reader.ts';

type EventHandler = (
  event: APIGatewayProxyEventV2,
  context: Context,
) => Promise<APIGatewayProxyStructuredResultV2>;

// Only deployed exports are wrapped; local factories supply their own simulated dependencies.
export function protectEventOrigin(
  handler: EventHandler,
  env: NodeJS.ProcessEnv,
  read: ParameterReader = readParameter,
): EventHandler {
  const token = refreshing(
    async () => {
      const values = { ...env };
      await applyParameter(values, 'ingress', read);
      const value = values.ORIGIN_VERIFY_TOKEN;
      if (typeof value !== 'string' || value.length < 32)
        throw new Error('Origin configuration unavailable.');
      return createHash('sha256').update(value).digest();
    },
    () => new Error('Origin configuration unavailable.'),
  );
  return async (event, context) => {
    let expected: Buffer;
    try {
      expected = await token();
    } catch {
      return {
        statusCode: 503,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: '{"statusCode":503,"message":"Service Unavailable"}',
      };
    }
    const received = Object.entries(event.headers ?? {}).find(
      ([name]) => name.toLowerCase() === 'x-modo-playa-origin',
    )?.[1];
    if (
      typeof received !== 'string' ||
      !timingSafeEqual(expected, createHash('sha256').update(received).digest())
    )
      return {
        statusCode: 403,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: '{"statusCode":403,"message":"Forbidden"}',
      };
    const origin = Object.entries(event.headers ?? {}).find(
      ([name]) => name.toLowerCase() === 'origin',
    )?.[1];
    const allowed = (env.CORS_ORIGIN ?? '*').split(',').map((item) => item.trim());
    const cors: Record<string, string> = {
      'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'Authorization,Content-Type',
      vary: 'Origin',
    };
    if (allowed.includes('*')) cors['access-control-allow-origin'] = '*';
    else if (origin && allowed.includes(origin)) cors['access-control-allow-origin'] = origin;
    const method = event.requestContext.http.method;
    if (method === 'OPTIONS') return { statusCode: 204, headers: cors };
    const input =
      method === 'HEAD'
        ? {
            ...event,
            routeKey: event.routeKey.replace(/^HEAD /, 'GET '),
            requestContext: {
              ...event.requestContext,
              http: { ...event.requestContext.http, method: 'GET' },
            },
          }
        : event;
    const response = await handler(input, context);
    return {
      ...response,
      headers: { ...response.headers, ...cors },
      ...(method === 'HEAD' ? { body: undefined, isBase64Encoded: false } : {}),
    };
  };
}
