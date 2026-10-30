import { protectEventOrigin } from '../http/origin.ts';
import { executeManagementOperation } from './operations.ts';
import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { selectOperation, pathParameters } from '../http/operation.ts';
import {
  validateEvent,
  json,
  notFound,
  errorResponse,
  queryParameters,
  parseBody,
} from '../http/request.ts';
import {
  validateBusiness,
  normalizeBusinessQuery,
  normalizeBusinessBody,
} from '../business/validation.ts';
import type { ContactsRepository } from '../business/contacts.repository.ts';
import type { LodgingsRepository } from '../business/lodgings.repository.ts';
import type { DashboardService } from '../business/dashboard.service.ts';
import type { MediaUrlBuilder } from '../identity/media-urls.ts';
import type { TokenService } from '../identity/tokens.ts';
import { managementRuntime } from './runtime.ts';
export interface ManagementServices {
  contacts: Pick<ContactsRepository, keyof ContactsRepository>;
  lodgings: Pick<LodgingsRepository, keyof LodgingsRepository>;
  dashboard: Pick<DashboardService, 'getSummary'>;
  mediaUrls: MediaUrlBuilder;
}
export interface ManagementDependencies {
  logRequests: boolean;
  runtime: (signal: AbortSignal) => Promise<{
    tokens: Pick<TokenService, 'authenticate'>;
    services: (mediaRequired: boolean) => Promise<ManagementServices>;
  }>;
}
export function createManagementHandler(
  dependencies: ManagementDependencies,
  group: 'management' | 'media' = 'management',
) {
  return middy<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>({
    timeoutEarlyInMillis: 0,
  })
    .use({
      after({ context, response }) {
        if (dependencies.logRequests)
          console.info({ requestId: context.awsRequestId, statusCode: response.statusCode });
      },
    })
    .handler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>(async (event, context) => {
      try {
        if (!validateEvent(event))
          return json(400, { statusCode: 400, message: 'Bad Request', error: 'Bad Request' });
        const route = selectOperation(group, event);
        if (!route) return notFound(event);
        const rawBody = parseBody(event);
        const signal = AbortSignal.timeout(
          Math.max(1, Math.min(18000, context.getRemainingTimeInMillis() - 250)),
        );
        const runtime = await dependencies.runtime(signal);
        const user = runtime.tokens.authenticate(
          Object.entries(event.headers).find(
            ([name]) => name.toLowerCase() === 'authorization',
          )?.[1],
        );
        const body = route.body
          ? validateBusiness(route.body, normalizeBusinessBody(rawBody))
          : undefined;
        const query = route.query
          ? validateBusiness(
              route.query,
              normalizeBusinessQuery(queryParameters(event), route.operation),
            )
          : undefined;
        const parameters = pathParameters(route.path, event.rawPath);
        if (route.parameters) validateBusiness(route.parameters, parameters);
        const { contacts, lodgings, dashboard, mediaUrls } = await runtime.services(
          !!route.mediaDependency,
        );
        const result = await executeManagementOperation(route, parameters, body, query, user, {
          contacts,
          lodgings,
          dashboard,
          mediaUrls,
        });
        return json(route.method === 'POST' ? 201 : 200, result);
      } catch (error) {
        return errorResponse(error);
      }
    });
}
export const handler = protectEventOrigin(
  createManagementHandler({
    logRequests: true,
    runtime: managementRuntime(process.env),
  }),
  process.env,
);
export { createManagementApplication } from './application.ts';
export { ContactsRepository } from '../business/contacts.repository.ts';
export { LodgingsRepository } from '../business/lodgings.repository.ts';
