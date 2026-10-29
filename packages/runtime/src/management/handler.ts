import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type {
  CreateContactInput,
  UpdateContactInput,
  ContactsQuery,
  AdminLodgingsQuery,
  CreateLodgingInput,
  UpdateLodgingInput,
  AvailabilityRange,
  VisibilityInput,
} from '@modo-playa/contracts/business';
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
import { ContactMapper } from '../business/contacts.mapper.ts';
import { LodgingMapper } from '../business/lodgings.mapper.ts';
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
export function createManagementHandler(dependencies: ManagementDependencies) {
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
        const route = selectOperation('management', event);
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
        const id = parameters.id!;
        const owner = user.ownerId;
        const role = user.role;
        let result: unknown;
        switch (route.operation) {
          case 'createContact':
            result = ContactMapper.toResponse(
              await contacts.create(body as CreateContactInput, owner, role),
            );
            break;
          case 'listContacts': {
            const page = await contacts.findAll(query as ContactsQuery, owner, role);
            result = { ...page, data: page.data.map((value) => ContactMapper.toResponse(value)) };
            break;
          }
          case 'getContact':
            result = ContactMapper.toResponse(
              await contacts.findOne(
                id,
                (query as { includeInactive: boolean }).includeInactive,
                owner,
                role,
              ),
            );
            break;
          case 'updateContact':
            result = ContactMapper.toResponse(
              await contacts.update(id, body as UpdateContactInput, owner, role),
            );
            break;
          case 'deleteContact':
            result = await contacts.remove(id, owner, role);
            break;
          case 'createLodging':
            result = LodgingMapper.toResponse(
              await lodgings.create(body as CreateLodgingInput, owner, role),
              mediaUrls,
            );
            break;
          case 'listAdminLodgings': {
            const page = await lodgings.findAdminPaginated(
              query as AdminLodgingsQuery,
              owner,
              role,
            );
            result = {
              ...page,
              data: page.data.map((value) => LodgingMapper.toResponse(value, mediaUrls)),
            };
            break;
          }
          case 'getAdminLodging':
            result = LodgingMapper.toResponse(
              await lodgings.findAdminById(id, owner, role),
              mediaUrls,
            );
            break;
          case 'updateLodging':
            result = LodgingMapper.toResponse(
              await lodgings.update(id, body as UpdateLodgingInput, owner, role),
              mediaUrls,
            );
            break;
          case 'deleteLodging':
            result = await lodgings.remove(id, owner, role);
            break;
          case 'setPublicVisibility':
            result = LodgingMapper.toResponse(
              await lodgings.setPublicVisibility(id, body as VisibilityInput, owner, role),
              mediaUrls,
            );
            break;
          case 'getOccupiedRanges':
            result = await lodgings.getOccupiedRanges(id, owner, role);
            break;
          case 'addOccupiedRange':
            result = await lodgings.addOccupiedRange(id, body as AvailabilityRange, owner, role);
            break;
          case 'removeOccupiedRange':
            result = await lodgings.removeOccupiedRange(id, body as AvailabilityRange, owner, role);
            break;
          case 'dashboardSummary':
            result = await dashboard.getSummary(owner, role);
            break;
          default:
            throw new Error('Unknown management operation.');
        }
        return json(route.method === 'POST' ? 201 : 200, result);
      } catch (error) {
        return errorResponse(error);
      }
    });
}
export const handler = createManagementHandler({
  logRequests: true,
  runtime: managementRuntime(process.env),
});
export { createManagementApplication } from './application.ts';
export { ContactsRepository } from '../business/contacts.repository.ts';
export { LodgingsRepository } from '../business/lodgings.repository.ts';
