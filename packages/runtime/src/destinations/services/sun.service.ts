import type { JsonHttpClient } from '../http-client.ts';
import { ProviderUnavailable } from '../errors.ts';
import type { DestinationConfig } from '../interfaces/destination.interface.ts';
import type { SunContext, SunriseSunsetApiResponse } from '../interfaces/sun.interface.ts';

const SUN_API_URL = 'https://api.sunrise-sunset.org/json';

export class SunService {
  constructor(private readonly http: JsonHttpClient) {}

  async getContext(destination: DestinationConfig, signal: AbortSignal): Promise<SunContext> {
    try {
      const data = (await this.http(SUN_API_URL, {
        provider: 'sun',
        signal,
        params: {
          lat: destination.latitude,
          lng: destination.longitude,
          formatted: 0,
        },
      })) as SunriseSunsetApiResponse;

      const { status, results } = data;

      if (status !== 'OK' || !results?.sunrise || !results?.sunset) {
        throw new ProviderUnavailable('Respuesta incompleta del proveedor de amanecer/atardecer');
      }

      return {
        sunrise: this.formatLocalTime(results.sunrise, destination.timezone),
        sunset: this.formatLocalTime(results.sunset, destination.timezone),
      };
    } catch (error) {
      if (error instanceof ProviderUnavailable) {
        throw error;
      }

      throw new ProviderUnavailable('No se pudo obtener información solar del destino');
    }
  }

  private formatLocalTime(dateIso: string, timezone: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(dateIso));
  }
}
