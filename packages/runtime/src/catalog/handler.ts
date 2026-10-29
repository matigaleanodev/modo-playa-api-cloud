import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { PublicLodgingsQuery } from '@modo-playa/contracts/business';
import { selectOperation, pathParameters } from '../http/operation.ts';
import { validateEvent, json, notFound, errorResponse, queryParameters } from '../http/request.ts';
import { validateBusiness, normalizeBusinessQuery } from '../business/validation.ts';
import { LodgingMapper } from '../business/lodgings.mapper.ts';
import type { LodgingsRepository } from '../business/lodgings.repository.ts';
import type { DestinationsService } from '../destinations/destinations.service.ts';
import type { MediaUrlBuilder } from '../identity/media-urls.ts';
import { catalogRuntime } from './runtime.ts';
export interface CatalogDependencies {
  logRequests: boolean;
  runtime: (signal: AbortSignal) => Promise<{
    destinations: Pick<DestinationsService, 'getAll' | 'getContext'>;
    catalog: () => Promise<{
      lodgings: Pick<LodgingsRepository, 'findPublicPaginated' | 'findPublicById'>;
      mediaUrls: MediaUrlBuilder;
    }>;
  }>;
}
export function createCatalogHandler(dependencies: CatalogDependencies) {
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
        const route = selectOperation('catalog', event);
        if (!route) return notFound(event);
        const parameters = pathParameters(route.path, event.rawPath);
        if (route.operation === 'destinationContext')
          parameters.id = parameters.id?.toLowerCase() ?? '';
        if (route.parameters) validateBusiness(route.parameters, parameters);
        const query = route.query
          ? validateBusiness<PublicLodgingsQuery>(
              route.query,
              normalizeBusinessQuery(queryParameters(event), route.operation),
            )
          : undefined;
        const signal = AbortSignal.timeout(
          Math.max(1, Math.min(18000, context.getRemainingTimeInMillis() - 250)),
        );
        const runtime = await dependencies.runtime(signal);
        if (route.operation === 'listDestinations') return json(200, runtime.destinations.getAll());
        if (route.operation === 'destinationContext')
          return json(
            200,
            await runtime.destinations.getContext(
              parameters.id as Parameters<DestinationsService['getContext']>[0],
              signal,
            ),
          );
        const { lodgings, mediaUrls } = await runtime.catalog();
        if (route.operation === 'getPublicLodging')
          return json(
            200,
            LodgingMapper.toPublicResponse(
              await lodgings.findPublicById(parameters.id!),
              mediaUrls,
            ),
          );
        const page = await lodgings.findPublicPaginated(query!);
        return json(200, {
          ...page,
          data: page.data.map((value) => LodgingMapper.toPublicResponse(value, mediaUrls)),
        });
      } catch (error) {
        return errorResponse(error);
      }
    });
}
export const handler = createCatalogHandler({
  logRequests: true,
  runtime: catalogRuntime(process.env),
});
export { DestinationsService } from '../destinations/destinations.service.ts';
export { WeatherService } from '../destinations/services/weather.service.ts';
export { SunService } from '../destinations/services/sun.service.ts';
export { CloudflareMediaUrlBuilderService } from '../identity/media-urls.ts';
