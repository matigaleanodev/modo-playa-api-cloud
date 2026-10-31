import { expect, it, vi } from 'vitest';
import { mediaConfiguration } from '../packages/runtime/src/media/configuration.ts';
import { businessConfiguration } from '../packages/runtime/src/business/configuration.ts';
import { MediaDependencyUnavailable } from '../packages/runtime/src/business/media.ts';

const principal = '/modo-playa/prod/app-properties';
const storage = '/modo-playa/prod/object-storage';

it('media combina dos dominios sensibles y conserva R2/limits públicos exclusivamente del entorno', async () => {
  const read = vi.fn(async (reference: string) =>
    JSON.stringify(
      reference === principal
        ? {
            MONGO_URI: 'mongodb://127.0.0.1:1/simulated',
            SECRET_KEY: 'simulated-jwt-key',
            R2_BUCKET: 'ignored-secret-field',
          }
        : { R2_ACCESS_KEY_ID: 'simulated-access', R2_SECRET_ACCESS_KEY: 'simulated-storage-key' },
    ),
  );
  const configuration = mediaConfiguration(
    {
      APP_PARAMETER_NAME: principal,
      STORAGE_PARAMETER_NAME: storage,
      R2_ENDPOINT: 'https://storage.example.test',
      R2_BUCKET: 'simulated-bucket',
      R2_REGION: 'auto',
      MEDIA_PUBLIC_BASE_URL: 'https://media.example.test',
      MEDIA_REQUEST_TIMEOUT_MS: '90000',
    },
    read,
  );
  expect(read).not.toHaveBeenCalled();
  const [a, b] = await Promise.all([configuration(), configuration()]);
  expect(a).toBe(b);
  expect(a).toMatchObject({
    mongoUri: 'mongodb://127.0.0.1:1/simulated',
    secretKey: 'simulated-jwt-key',
    requestTimeoutMs: 90000,
    lodgingMaxBytes: 10 * 1024 * 1024,
    profileMaxBytes: 5 * 1024 * 1024,
    storage: {
      endpoint: 'https://storage.example.test',
      bucket: 'simulated-bucket',
      accessKeyId: 'simulated-access',
      secretAccessKey: 'simulated-storage-key',
      region: 'auto',
    },
  });
  expect(read.mock.calls.map(([reference]) => reference)).toEqual([principal, storage]);
  const invalid = mediaConfiguration({ APP_PARAMETER_NAME: principal }, async () => {
    throw new Error('sensitive-provider-error');
  });
  await expect(invalid()).rejects.toBeInstanceOf(MediaDependencyUnavailable);
  await expect(invalid()).rejects.not.toThrow('sensitive-provider-error');
});

it('catálogo lee sólo Mongo; management comparte principal sin exigir correo ni R2', async () => {
  const database = '/modo-playa/prod/database';
  const read = vi.fn(async (reference: string) =>
    JSON.stringify(
      reference === database
        ? { MONGO_URI: 'mongodb://127.0.0.1:1/simulated' }
        : { MONGO_URI: 'mongodb://127.0.0.1:1/simulated', SECRET_KEY: 'simulated-jwt-key' },
    ),
  );
  expect(
    await businessConfiguration('catalog', { DATABASE_PARAMETER_NAME: database }, read)(),
  ).toMatchObject({ secretKey: undefined });
  expect(
    await businessConfiguration('management', { APP_PARAMETER_NAME: principal }, read)(),
  ).toMatchObject({ secretKey: 'simulated-jwt-key' });
  expect(read.mock.calls.map(([reference]) => reference)).toEqual([database, principal]);
});
