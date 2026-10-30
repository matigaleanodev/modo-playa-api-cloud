import { protectEventOrigin } from '../http/origin.ts';
import middy from '@middy/core';
import { Ajv } from 'ajv';
import { httpEventSchema, type HttpEvent } from '@modo-playa/contracts/http-input';
import type { HealthResponse } from '@modo-playa/contracts/health';
import { routes } from '@modo-playa/contracts/routes';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { selectOperation } from '../http/operation.ts';

const validateEvent = new Ajv({ strict: true }).compile<HttpEvent>(httpEventSchema);

interface RuntimeConfiguration {
  logRequests: boolean;
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

export function createHealthHandler(configuration: RuntimeConfiguration) {
  return middy<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>({
    timeoutEarlyInMillis: 0,
  })
    .use({
      before({ event }) {
        if (!validateEvent(event)) {
          return json(400, { statusCode: 400, message: 'Bad Request', error: 'Bad Request' });
        }
        if (!selectOperation(routes.health.group, event)) {
          return json(404, {
            statusCode: 404,
            message: `Cannot ${event.requestContext.http.method} ${event.rawPath}`,
            error: 'Not Found',
          });
        }
      },
      after({ context, response }) {
        if (configuration.logRequests) {
          console.info({
            requestId: context.awsRequestId,
            operation: routes.health.operation,
            statusCode: response.statusCode,
          });
        }
      },
    })
    .handler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>(async () => {
      const body: HealthResponse = { status: 'ok' };
      return json(200, body);
    });
}

export const handler = protectEventOrigin(createHealthHandler({ logRequests: true }), process.env);
