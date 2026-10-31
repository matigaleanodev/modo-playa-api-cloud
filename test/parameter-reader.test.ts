import { afterEach, expect, it, vi } from 'vitest';
import { SSMClient } from '@aws-sdk/client-ssm';
import {
  CONFIGURATION_TTL_MS,
  readParameter,
  refreshing,
} from '../packages/runtime/src/http/parameter-reader.ts';
import { businessConfiguration } from '../packages/runtime/src/business/configuration.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('lee SecureString con descifrado y rechaza nombres o tipos fuera del contrato', async () => {
  const send = vi.spyOn(SSMClient.prototype, 'send');
  send.mockResolvedValueOnce({ Parameter: { Type: 'SecureString', Value: '{"a":"b"}' } } as never);
  await expect(readParameter('/modo-playa/prod/email', AbortSignal.timeout(1000))).resolves.toBe(
    '{"a":"b"}',
  );
  const command = send.mock.calls[0]![0] as { input: object };
  expect(command.input).toEqual({ Name: '/modo-playa/prod/email', WithDecryption: true });
  await expect(readParameter('/modo-playa/prod/other', AbortSignal.timeout(1000))).rejects.toThrow(
    'Configuration unavailable.',
  );
  await expect(readParameter('/other/prod/email', AbortSignal.timeout(1000))).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
  send.mockResolvedValueOnce({ Parameter: { Type: 'String', Value: '{}' } } as never);
  await expect(readParameter('/modo-playa/prod/email', AbortSignal.timeout(1000))).rejects.toThrow(
    'Configuration unavailable.',
  );
});

it('refresca al vencer, comparte la carga en curso y no reutiliza un valor vencido tras un fallo', async () => {
  vi.useFakeTimers();
  const load = vi
    .fn<() => Promise<number>>()
    .mockResolvedValueOnce(1)
    .mockRejectedValueOnce(new Error('simulated'))
    .mockResolvedValueOnce(2);
  const value = refreshing(load, () => new Error('unavailable'));
  const [a, b] = await Promise.all([value(), value()]);
  expect([a, b]).toEqual([1, 1]);
  vi.advanceTimersByTime(CONFIGURATION_TTL_MS - 1);
  await expect(value()).resolves.toBe(1);
  vi.advanceTimersByTime(1);
  await expect(value()).rejects.toThrow('unavailable');
  await expect(value()).resolves.toBe(2);
  expect(load).toHaveBeenCalledTimes(3);
});

it('rechaza parámetros vacíos o sin las claves del dominio', async () => {
  for (const body of ['[]', '{"MONGO_URI":""}', '{"OTHER":"x"}'])
    await expect(
      businessConfiguration(
        'catalog',
        { DATABASE_PARAMETER_NAME: '/modo-playa/prod/database' },
        async () => body,
      )(),
    ).rejects.toThrow('Runtime configuration unavailable.');
});
