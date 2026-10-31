import {
  applyParameter,
  readParameter,
  refreshing,
  type ParameterReader,
} from '../http/parameter-reader.ts';
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
export function mediaConfiguration(env: NodeJS.ProcessEnv, read: ParameterReader = readParameter) {
  return refreshing<MediaConfiguration>(
    async () => {
      const values = { ...env };
      await applyParameter(values, 'app', read);
      await applyParameter(values, 'storage', read);
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
    },
    () => new MediaDependencyUnavailable(),
  );
}
