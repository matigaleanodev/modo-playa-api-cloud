import { database } from '../identity/database.ts';
import { businessModels } from '../business/models.ts';
import { LodgingsRepository } from '../business/lodgings.repository.ts';
import { requireLodgingMedia } from '../business/media.ts';
import { businessConfiguration } from '../business/configuration.ts';
import { CloudflareMediaUrlBuilderService } from '../identity/media-urls.ts';
import { DestinationsService } from '../destinations/destinations.service.ts';
import { WeatherService } from '../destinations/services/weather.service.ts';
import { SunService } from '../destinations/services/sun.service.ts';
import { createJsonHttpClient } from '../destinations/http-client.ts';
export function catalogRuntime(env: NodeJS.ProcessEnv) {
  const configuration = businessConfiguration('catalog', env);
  const db = database(async () => (await configuration()).mongoUri);
  const http = createJsonHttpClient();
  // La cache pertenece a la instancia cálida, nunca al request ni a un scheduler.
  const destinations = new DestinationsService(new WeatherService(http), new SunService(http));
  return async (signal: AbortSignal) => ({
    destinations,
    async catalog() {
      const config = await configuration();
      const connection = await db.connect();
      signal.throwIfAborted();
      const models = businessModels(connection);
      return {
        lodgings: new LodgingsRepository(models.lodgings, models.contacts, {
          attachDraftUploadsToLodging: requireLodgingMedia,
          deleteAllForLodging: requireLodgingMedia,
        }),
        mediaUrls: new CloudflareMediaUrlBuilderService(config),
      };
    },
  });
}
