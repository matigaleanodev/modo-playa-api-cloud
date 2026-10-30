import type { JsonHttpClient } from '../http-client.ts';
import { ProviderUnavailable } from '../errors.ts';
import type { DestinationConfig } from '../interfaces/destination.interface.ts';
import type { OpenMeteoApiResponse, WeatherContext } from '../interfaces/weather.interface.ts';
import type { DestinationId } from '../providers/destination-id.enum.ts';

interface CacheEntry {
  expiresAt: number;
  value: WeatherContext;
}

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;

export class WeatherService {
  private readonly weatherCache = new Map<DestinationId, CacheEntry>();

  constructor(private readonly http: JsonHttpClient) {}

  async getContext(destination: DestinationConfig, signal: AbortSignal): Promise<WeatherContext> {
    const cached = this.weatherCache.get(destination.id);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const fresh = await this.fetchWeather(destination, signal);
    this.weatherCache.set(destination.id, {
      value: fresh,
      expiresAt: now + WEATHER_CACHE_TTL_MS,
    });

    return fresh;
  }

  private async fetchWeather(
    destination: DestinationConfig,
    signal: AbortSignal,
  ): Promise<WeatherContext> {
    try {
      const data = (await this.http(OPEN_METEO_URL, {
        provider: 'weather',
        signal,
        params: {
          latitude: destination.latitude,
          longitude: destination.longitude,
          current_weather: true,
          daily: 'temperature_2m_max,temperature_2m_min',
          timezone: 'auto',
          forecast_days: 2,
        },
      })) as OpenMeteoApiResponse;

      const currentWeather = data.current_weather;
      const daily = data.daily;
      const maxTemps = daily?.temperature_2m_max ?? [];
      const minTemps = daily?.temperature_2m_min ?? [];

      const windSpeed = currentWeather?.wind_speed ?? currentWeather?.windspeed;

      if (
        currentWeather?.temperature === undefined ||
        windSpeed === undefined ||
        currentWeather.weathercode === undefined ||
        maxTemps.length < 2 ||
        minTemps.length < 2
      ) {
        throw new ProviderUnavailable('Respuesta incompleta del proveedor de clima');
      }

      return {
        weather: {
          temperature: Math.round(currentWeather.temperature),
          windSpeed: Math.round(windSpeed),
          weatherCode: currentWeather.weathercode,
        },
        forecast: [
          {
            day: 'today',
            max: Math.round(maxTemps[0]),
            min: Math.round(minTemps[0]),
          },
          {
            day: 'tomorrow',
            max: Math.round(maxTemps[1]),
            min: Math.round(minTemps[1]),
          },
        ],
      };
    } catch (error) {
      if (error instanceof ProviderUnavailable) {
        throw error;
      }

      throw new ProviderUnavailable('No se pudo obtener información del clima');
    }
  }
}
