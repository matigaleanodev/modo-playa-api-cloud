import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { readSecret, type SecretReader } from './secret-reader.ts';

type EventHandler = (
  event: APIGatewayProxyEventV2,
  context: Context,
) => Promise<APIGatewayProxyStructuredResultV2>;

// Only deployed exports are wrapped; local factories supply their own simulated dependencies.
export function protectEventOrigin(
  handler: EventHandler,
  env: NodeJS.ProcessEnv,
  read: SecretReader = readSecret,
): EventHandler {
  let pending: Promise<Buffer> | undefined;
  const token = () => {
    pending ??= (async () => {
      let value: unknown = env.ORIGIN_VERIFY_TOKEN;
      if (env.ORIGIN_SECRET_ARN) {
        const secret: unknown = JSON.parse(
          await read(env.ORIGIN_SECRET_ARN, AbortSignal.timeout(2000)),
        );
        if (!secret || typeof secret !== 'object' || Array.isArray(secret))
          throw new Error('Origin configuration unavailable.');
        value = (secret as Record<string, unknown>).ORIGIN_VERIFY_TOKEN;
      }
      if (typeof value !== 'string' || value.length < 32)
        throw new Error('Origin configuration unavailable.');
      return createHash('sha256').update(value).digest();
    })().catch(() => {
      pending = undefined;
      throw new Error('Origin configuration unavailable.');
    });
    return pending;
  };
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
