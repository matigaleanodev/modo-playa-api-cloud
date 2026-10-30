import { protectEventOrigin } from '../http/origin.ts';
import middy from '@middy/core';
import { Ajv } from 'ajv';
import { httpEventSchema, type HttpEvent } from '@modo-playa/contracts/http-input';
import type { HealthResponse } from '@modo-playa/contracts/health';
import { routes } from '@modo-playa/contracts/routes';
import { documentationPaths } from '@modo-playa/contracts/documentation';
import { createOpenApiDocument } from '@modo-playa/contracts/openapi';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { selectOperation } from '../http/operation.ts';

const validateEvent = new Ajv({ strict: true }).compile<HttpEvent>(httpEventSchema);

const documentationHtml = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Modo Playa API - Swagger UI</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.31.0/swagger-ui.css" integrity="sha384-KX9Rx9vM1AmUNAn07bPAiZhFD4C8jdNgG6f5MRNvR+EfAxs2PmMFtUUazui7ryZQ" crossorigin="anonymous"></head>
<body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.31.0/swagger-ui-bundle.js" integrity="sha384-cxafBeQ+zYROeFafGFxtFbnp1ICqeS9mG7+f0WWSHzhnrUvwg9Za5CCw6wgrHA7K" crossorigin="anonymous"></script>
<script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',tagsSorter:'alpha',operationsSorter:'alpha',validatorUrl:null});</script></body></html>`;

function isDocumentationRequest(event: HttpEvent) {
  return (
    event.requestContext.http.method === 'GET' &&
    event.routeKey === 'GET ' + event.rawPath &&
    documentationPaths.some((path) => path === event.rawPath)
  );
}

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
        if (!selectOperation(routes.health.group, event) && !isDocumentationRequest(event)) {
          return json(404, {
            statusCode: 404,
            message: `Cannot ${event.requestContext.http.method} ${event.rawPath}`,
            error: 'Not Found',
          });
        }
      },
      after({ event, context, response }) {
        if (configuration.logRequests) {
          console.info({
            requestId: context.awsRequestId,
            operation: isDocumentationRequest(event) ? 'getDocumentation' : routes.health.operation,
            statusCode: response.statusCode,
          });
        }
      },
    })
    .handler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>(async (event) => {
      if (event.rawPath === '/openapi.json') return json(200, createOpenApiDocument());
      if (isDocumentationRequest(event))
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: documentationHtml,
        };
      const body: HealthResponse = { status: 'ok' };
      return json(200, body);
    });
}

export const handler = protectEventOrigin(createHealthHandler({ logRequests: true }), process.env);
