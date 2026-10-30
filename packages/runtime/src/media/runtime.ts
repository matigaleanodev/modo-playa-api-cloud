import { database } from '../identity/database.ts';
import { TokenService } from '../identity/tokens.ts';
import { MediaDependencyUnavailable } from '../business/media.ts';
import { mediaConfiguration } from './configuration.ts';
import { createMediaApplication } from './application.ts';
import { R2ObjectStorageService } from './storage.ts';
export function mediaRuntime(env: NodeJS.ProcessEnv) {
  const configuration = mediaConfiguration(env);
  const db = database(async () => (await configuration()).mongoUri);
  return async (signal: AbortSignal) => {
    const config = await configuration();
    return {
      tokens: new TokenService(config.secretKey),
      config,
      services: async (requestSignal: AbortSignal = signal) => {
        if (Object.values(config.storage).some((value) => !value.trim()))
          throw new MediaDependencyUnavailable();
        const storage = new R2ObjectStorageService(config.storage, requestSignal);
        requestSignal.throwIfAborted();
        const [{ default: sharp }, { SharpImageProcessorService }] = await Promise.all([
          import('sharp'),
          import('./sharp.ts'),
        ]);
        const connection = await db.connect();
        requestSignal.throwIfAborted();
        return createMediaApplication(
          connection,
          config,
          storage,
          new SharpImageProcessorService(sharp),
          requestSignal,
        );
      },
    };
  };
}
