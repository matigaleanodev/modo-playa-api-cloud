import { createIdentityApplication } from './application.ts';
import { runtimeConfiguration } from './configuration.ts';
import { database } from './database.ts';
import { createResendMail } from './mail.ts';
import { TokenService } from './tokens.ts';

export function identityRuntime(env: NodeJS.ProcessEnv) {
  const configuration = runtimeConfiguration(env);
  const db = database(async () => (await configuration()).mongoUri);
  return async (signal: AbortSignal) => {
    const config = await configuration();
    const tokens = new TokenService(config.secretKey);
    // Resolver el repositorio queda diferido hasta después de validar Bearer y el request.
    return {
      tokens,
      async services() {
        const users = await db.users(signal);
        return createIdentityApplication(config, { users, mail: createResendMail(config, signal) });
      },
    };
  };
}
