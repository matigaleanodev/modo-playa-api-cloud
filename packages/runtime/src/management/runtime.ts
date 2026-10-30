import { database } from '../identity/database.ts';
import { TokenService } from '../identity/tokens.ts';
import { businessConfiguration } from '../business/configuration.ts';
import { requireLodgingMedia, type LodgingMedia } from '../business/media.ts';
import { createManagementApplication } from './application.ts';
export function managementRuntime(env: NodeJS.ProcessEnv, media?: LodgingMedia) {
  const configuration = businessConfiguration('management', env);
  const db = database(async () => (await configuration()).mongoUri);
  return async (signal: AbortSignal) => {
    const config = await configuration();
    return {
      tokens: new TokenService(config.secretKey!),
      async services(mediaRequired: boolean) {
        // Sin integración real se rechaza antes de abrir Mongo o escribir documentos.
        if (mediaRequired && !media) requireLodgingMedia();
        const connection = await db.connect();
        signal.throwIfAborted();
        return createManagementApplication(
          connection,
          config,
          media ?? {
            attachDraftUploadsToLodging: requireLodgingMedia,
            deleteAllForLodging: requireLodgingMedia,
          },
        );
      },
    };
  };
}
