import { afterEach, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import axios from 'axios';
import {
  createJsonHttpClient,
  type JsonHttpClient,
} from '../packages/runtime/src/destinations/http-client.ts';
import { DestinationsService } from '../packages/runtime/src/destinations/destinations.service.ts';
import { WeatherService } from '../packages/runtime/src/destinations/services/weather.service.ts';
import { SunService } from '../packages/runtime/src/destinations/services/sun.service.ts';
import { DESTINATIONS } from '../packages/runtime/src/destinations/providers/destinations.config.ts';
const weatherData = {
  current_weather: { temperature: 25.6, windspeed: 14.4, weathercode: 3 },
  daily: { temperature_2m_max: [28.2, 30.5], temperature_2m_min: [16.3, 17.5] },
};
const sunData = {
  status: 'OK',
  results: { sunrise: '2026-01-10T09:12:00Z', sunset: '2026-01-10T23:05:00Z' },
};
afterEach(() => vi.restoreAllMocks());
it('contexto completo conserva proveedores en paralelo, parámetros, timezone y cache solo de clima por 30 minutos', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const http = vi.fn<JsonHttpClient>(async (url, request) => {
    calls.push(request.provider);
    signals.push(request.signal);
    if (request.provider === 'weather') {
      expect(url).toBe('https://api.open-meteo.com/v1/forecast');
      expect(request.params).toEqual({
        latitude: -37.2639,
        longitude: -56.973,
        current_weather: true,
        daily: 'temperature_2m_max,temperature_2m_min',
        timezone: 'auto',
        forecast_days: 2,
      });
      await Promise.resolve();
      expect(calls).toContain('sun');
      return weatherData;
    }
    expect(request.params).toEqual({ lat: -37.2639, lng: -56.973, formatted: 0 });
    return sunData;
  });
  const service = new DestinationsService(new WeatherService(http), new SunService(http));
  const signal = AbortSignal.timeout(1000);
  const result = await service.getContext(DESTINATIONS[0]!.id, signal);
  expect(result).toMatchObject({
    destinationId: 'gesell',
    destination: 'Villa Gesell',
    timezone: 'America/Argentina/Buenos_Aires',
    weather: { temperature: 26, windSpeed: 14, weatherCode: 3 },
    forecast: [
      { day: 'today', max: 28, min: 16 },
      { day: 'tomorrow', max: 31, min: 18 },
    ],
    sun: { sunrise: '06:12', sunset: '20:05' },
  });
  expect(result.pointsOfInterest.map((item) => item.id)).toEqual([
    'hospital',
    'police',
    'downtown',
    'pharmacy',
    'beach',
  ]);
  expect(signals.every((value) => value === signal)).toBe(true);
  await service.getContext(DESTINATIONS[0]!.id, signal);
  expect(calls).toEqual(['weather', 'sun', 'sun']);
  now += 30 * 60 * 1000;
  await service.getContext(DESTINATIONS[0]!.id, signal);
  expect(calls).toEqual(['weather', 'sun', 'sun', 'weather', 'sun']);
  expect(service.getAll().map((item) => item.id)).toEqual(['gesell', 'pampas', 'marazul']);
});
it('errores de proveedor mantienen mensajes y 503 saneados y clima fallido no entra en cache', async () => {
  const http = vi.fn<JsonHttpClient>().mockRejectedValue(new Error('sensitive axios config'));
  const weather = new WeatherService(http);
  const sun = new SunService(http);
  const signal = AbortSignal.timeout(1000);
  await expect(weather.getContext(DESTINATIONS[0]!, signal)).rejects.toMatchObject({
    status: 503,
    body: {
      message: 'No se pudo obtener información del clima',
      error: 'Service Unavailable',
      statusCode: 503,
    },
  });
  await expect(sun.getContext(DESTINATIONS[0]!, signal)).rejects.toMatchObject({
    status: 503,
    body: { message: 'No se pudo obtener información solar del destino' },
  });
  http.mockResolvedValueOnce({});
  await expect(weather.getContext(DESTINATIONS[0]!, signal)).rejects.toMatchObject({
    body: { message: 'Respuesta incompleta del proveedor de clima' },
  });
  expect(http).toHaveBeenCalledTimes(3);
  http.mockResolvedValueOnce({ status: 'INVALID_REQUEST' });
  await expect(sun.getContext(DESTINATIONS[0]!, signal)).rejects.toMatchObject({
    body: { message: 'Respuesta incompleta del proveedor de amanecer/atardecer' },
  });
});
it('Axios real acota respuesta y deadline, sin redirects/retries ni errores sensibles; servidor solo loopback', async () => {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.url!);
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/target' });
      res.end();
    } else if (req.url === '/large') res.end(' '.repeat(65537));
    else if (req.url === '/bad') res.end('not-json-sensitive');
    else if (req.url === '/slow') {
      res.writeHead(200);
      res.write('{');
    } else res.end('{"ok":true}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const logger = vi.fn();
  const spy = vi.spyOn(axios, 'create');
  const client = createJsonHttpClient(logger);
  try {
    const request = { provider: 'weather' as const, params: {}, signal: AbortSignal.timeout(2000) };
    expect(await client(base + '/ok', request)).toEqual({ ok: true });
    await expect(client(base + '/redirect', request)).rejects.toMatchObject({
      code: 'HTTP_STATUS',
      status: 302,
    });
    await expect(client(base + '/large', request)).rejects.toMatchObject({ code: 'RESPONSE_SIZE' });
    await expect(client(base + '/bad', request)).rejects.toMatchObject({ code: 'INVALID_JSON' });
    await expect(
      client(base + '/slow', { ...request, signal: AbortSignal.timeout(30) }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(calls).toEqual(['/ok', '/redirect', '/large', '/bad', '/slow']);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 10000, maxRedirects: 0, proxy: false, adapter: 'http' }),
    );
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(
      /config|headers|not-json-sensitive|127\.0\.0\.1/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
