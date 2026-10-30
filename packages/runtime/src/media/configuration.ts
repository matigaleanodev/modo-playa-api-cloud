import { readSecret, type SecretReader } from '../http/secret-reader.ts';
import { MediaDependencyUnavailable } from '../business/media.ts';
import type { BusinessConfiguration } from '../business/configuration.ts';
import type { MediaSettings } from './ports.ts';
import type { StorageSettings } from './storage.ts';
export interface MediaConfiguration extends BusinessConfiguration {
  secretKey: string;
  settings: MediaSettings;
  storage: StorageSettings;
  lodgingMaxBytes: number;
  profileMaxBytes: number;
  requestTimeoutMs: number;
}
export function mediaConfiguration(env: NodeJS.ProcessEnv, read: SecretReader = readSecret) {
  let pending: Promise<MediaConfiguration> | undefined;
  return () => {
    pending ??= (async () => {
      const values = { ...env };
      if (env.MEDIA_SECRET_ARN) {
        const secret: unknown = JSON.parse(
          await read(env.MEDIA_SECRET_ARN, AbortSignal.timeout(2000)),
        );
        if (!secret || typeof secret !== 'object' || Array.isArray(secret))
          throw new MediaDependencyUnavailable();
        for (const name of [
          'MONGO_URI',
          'SECRET_KEY',
          'R2_ENDPOINT',
          'R2_BUCKET',
          'R2_ACCESS_KEY_ID',
          'R2_SECRET_ACCESS_KEY',
        ]) {
          const value = (secret as Record<string, unknown>)[name];
          if (typeof value !== 'string' || !value.trim()) throw new MediaDependencyUnavailable();
          values[name] = value;
        }
      }
      if (!values.MONGO_URI?.trim() || !values.SECRET_KEY?.trim())
        throw new MediaDependencyUnavailable();
      const number = (name: string, fallback: number) => {
        const value = Number(values[name] ?? fallback);
        if (!Number.isSafeInteger(value) || value <= 0) throw new MediaDependencyUnavailable();
        return value;
      };
      return {
        mongoUri: values.MONGO_URI,
        secretKey: values.SECRET_KEY,
        publicBaseUrl: values.MEDIA_PUBLIC_BASE_URL ?? '',
        r2Endpoint: values.R2_ENDPOINT ?? '',
        r2Bucket: values.R2_BUCKET ?? '',
        storage: {
          endpoint: values.R2_ENDPOINT ?? '',
          bucket: values.R2_BUCKET ?? '',
          accessKeyId: values.R2_ACCESS_KEY_ID ?? '',
          secretAccessKey: values.R2_SECRET_ACCESS_KEY ?? '',
          region: values.R2_REGION ?? 'auto',
        },
        settings: { get: (name: string) => values[name] },
        lodgingMaxBytes: number('LODGING_IMAGE_MAX_BYTES', 10 * 1024 * 1024),
        profileMaxBytes: number('USER_PROFILE_IMAGE_MAX_BYTES', 5 * 1024 * 1024),
        requestTimeoutMs: number('MEDIA_REQUEST_TIMEOUT_MS', 90000),
      };
    })().catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
