import { readSecret, type SecretReader } from '../http/secret-reader.ts';
export type { SecretReader } from '../http/secret-reader.ts';
export interface IdentityConfiguration {
  mongoUri: string;
  secretKey: string;
  bcryptRounds: number;
  resendApiKey: string;
  resendFromEmail: string;
  superadminOwnerId?: string;
  publicBaseUrl: string;
  r2Endpoint: string;
  r2Bucket: string;
}
export function runtimeConfiguration(env: NodeJS.ProcessEnv, read: SecretReader = readSecret) {
  let pending: Promise<IdentityConfiguration> | undefined;
  return () => {
    pending ??= (async () => {
      const values = { ...env };
      for (const [reference, names] of [
        [env.IDENTITY_SECRET_ARN, ['MONGO_URI', 'SECRET_KEY']],
        [env.EMAIL_SECRET_ARN, ['RESEND_API_KEY']],
      ] as const) {
        if (!reference) continue;
        const secret: unknown = JSON.parse(await read(reference, AbortSignal.timeout(2000)));
        if (!secret || typeof secret !== 'object' || Array.isArray(secret))
          throw new Error('Invalid configuration.');
        for (const name of names) {
          const value = (secret as Record<string, unknown>)[name];
          if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid configuration.');
          values[name] = value;
        }
      }
      for (const name of ['MONGO_URI', 'SECRET_KEY', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'])
        if (!values[name]?.trim()) throw new Error('Missing configuration.');
      const bcryptRounds = Number(values.BCRYPT_ROUNDS ?? 12);
      if (!Number.isInteger(bcryptRounds) || bcryptRounds < 4 || bcryptRounds > 31)
        throw new Error('Invalid configuration.');
      return {
        mongoUri: values.MONGO_URI!,
        secretKey: values.SECRET_KEY!,
        bcryptRounds,
        resendApiKey: values.RESEND_API_KEY!,
        resendFromEmail: values.RESEND_FROM_EMAIL!,
        superadminOwnerId: values.SUPERADMIN_OWNER_ID,
        publicBaseUrl: values.MEDIA_PUBLIC_BASE_URL ?? '',
        r2Endpoint: values.R2_ENDPOINT ?? '',
        r2Bucket: values.R2_BUCKET ?? '',
      };
    })().catch(() => {
      pending = undefined;
      throw new Error('Runtime configuration unavailable.');
    });
    return pending;
  };
}
