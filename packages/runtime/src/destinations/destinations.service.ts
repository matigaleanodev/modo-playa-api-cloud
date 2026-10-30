import { HttpException } from '../identity/errors.ts';
import type { DestinationContext } from '@modo-playa/contracts/destinations';
import type { DestinationId } from './providers/destination-id.enum.ts';
import { DESTINATIONS, DESTINATIONS_MAP } from './providers/destinations.config.ts';
import { POINTS_OF_INTEREST_MAP } from './providers/points-of-interest.config.ts';
import type { WeatherService } from './services/weather.service.ts';
import type { SunService } from './services/sun.service.ts';

export class DestinationsService {
  constructor(
    private readonly weatherService: WeatherService,
    private readonly sunService: SunService,
  ) {}

  getAll(): Array<{ id: DestinationId; name: string }> {
    return DESTINATIONS.map((destination) => ({
      id: destination.id,
      name: destination.name,
    }));
  }

  async getContext(id: DestinationId, signal: AbortSignal): Promise<DestinationContext> {
    const destination = DESTINATIONS_MAP[id];

    if (!destination) {
      throw new HttpException(404, {
        message: 'Destino no encontrado',
        error: 'Not Found',
        statusCode: 404,
      });
    }

    const [weatherContext, sunContext] = await Promise.all([
      this.weatherService.getContext(destination, signal),
      this.sunService.getContext(destination, signal),
    ]);

    return {
      destinationId: destination.id,
      destination: destination.name,
      timezone: destination.timezone,
      weather: weatherContext.weather,
      forecast: weatherContext.forecast,
      sun: sunContext,
      pointsOfInterest: [...(POINTS_OF_INTEREST_MAP[destination.id] ?? [])],
    };
  }
}
