import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export type SecretReader = (reference: string, signal: AbortSignal) => Promise<string>;
let client: SecretsManagerClient | undefined;
export const readSecret: SecretReader = async (reference, signal) => {
  client ??= new SecretsManagerClient({ maxAttempts: 1 });
  const value = await client.send(new GetSecretValueCommand({ SecretId: reference }), {
    abortSignal: signal,
  });
  if (!value.SecretString) throw new Error('Configuration unavailable.');
  return value.SecretString;
};
