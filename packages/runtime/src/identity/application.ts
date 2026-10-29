import { AuthService } from './auth.service.ts';
import type { IdentityConfiguration } from './configuration.ts';
import type { Mail } from './mail.ts';
import { CloudflareMediaUrlBuilderService } from './media-urls.ts';
import { TokenService } from './tokens.ts';
import type { Users } from './users.repository.ts';

export function createIdentityApplication(
  config: Pick<
    IdentityConfiguration,
    'secretKey' | 'bcryptRounds' | 'superadminOwnerId' | 'publicBaseUrl' | 'r2Endpoint' | 'r2Bucket'
  >,
  dependencies: { users: Users; mail: Mail },
) {
  const tokens = new TokenService(config.secretKey);
  return {
    tokens,
    users: dependencies.users,
    auth: new AuthService(
      dependencies.users,
      tokens,
      config,
      dependencies.mail,
      new CloudflareMediaUrlBuilderService(config),
    ),
  };
}
